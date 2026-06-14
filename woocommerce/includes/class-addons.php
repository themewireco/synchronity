<?php
/**
 * ACF Product Add-ons — discovery, normalisation, price resolution and validation.
 *
 * This layer is ADDITIVE to native WooCommerce variations/attributes. It surfaces
 * per-product options modelled as ACF (Advanced Custom Fields) so agents can present
 * them in chat, collect a buyer's choices, and carry them through cart → checkout.
 *
 * All methods are static — the helper holds no state and is safe to call from the
 * normaliser, cart and checkout layers (and from the standalone test runner).
 *
 * ── Price map option format (`agentmesh_addon_price_map`, JSON) ──────────────────
 * A JSON object keyed by add-on field name. Per add-on the merchant supplies ONE of:
 *
 *   { "<addon_field>": { "amount": "10.00" } }                       // one fixed per-unit fee
 *   { "<addon_field>": { "options": { "<opt_value>": "5.00", … } } } // per-option fees (select/radio/checkbox)
 *   { "<addon_field>": { "price_field": "<acf_field_key_or_name>" } } // read the fee from another ACF field on the product
 *
 * Amounts are plain decimal strings/numbers in the store currency. The merchant map
 * ALWAYS wins over the auto cases (repeater subfield, `(+N)` label). Prices are NEVER
 * supplied by the client — only resolved here from trusted sources.
 *
 * AMPS shapes produced (mirror gateway `src/types/amps.ts`):
 *   AMPSProductAddon  = { addon_id, label, type, required, multiple, options?[], min?, max?, help? }
 *   AMPSAddonOption   = { value, label, price_modifier?:{amount,currency} }
 *   AMPSSelectedAddon = { addon_id, label, value:(string|string[]), price_modifier?:{amount,currency} }
 */

defined( 'ABSPATH' ) || exit;

class AgentMesh_Addons {

	/** Max characters accepted for a free-text add-on value (sanity cap). */
	const TEXT_MAX_LEN = 500;

	/** ACF field types that map to a customer-input AMPS add-on. */
	private const TYPE_MAP = [
		'select'       => 'select',   // → checkbox when ACF `multiple`
		'radio'        => 'radio',
		'button_group' => 'radio',
		'checkbox'     => 'checkbox',
		'true_false'   => 'boolean',
		'text'         => 'text',
		'textarea'     => 'text',
		'email'        => 'text',
		'url'          => 'text',
		'number'       => 'number',
		'range'        => 'number',
		'repeater'     => 'repeater', // expanded to select/checkbox below
	];

	// ─────────────────────────────────────────────────────────────────
	// extract_addons
	// ─────────────────────────────────────────────────────────────────

	/**
	 * Build the list of AMPS add-on definitions for a product.
	 *
	 * @return array<int,array> List of AMPSProductAddon arrays (empty when ACF is
	 *                          absent, the master toggle is off, or no input fields).
	 */
	public static function extract_addons( WC_Product $product ): array {
		// Guard: ACF inactive OR master toggle off → no add-ons.
		if ( ! function_exists( 'get_field_objects' ) ) {
			return [];
		}
		if ( ! self::truthy_option( get_option( 'agentmesh_addons_enabled', true ) ) ) {
			return [];
		}

		$fields = get_field_objects( $product->get_id() );
		if ( ! is_array( $fields ) || empty( $fields ) ) {
			return [];
		}

		$currency  = function_exists( 'get_woocommerce_currency' ) ? get_woocommerce_currency() : 'USD';
		$hide_list = self::hidden_fields();
		$price_map = self::price_map();

		$addons = [];
		foreach ( $fields as $name => $field ) {
			if ( ! is_array( $field ) ) {
				continue;
			}

			$acf_type = (string) ( $field['type'] ?? '' );
			if ( ! isset( self::TYPE_MAP[ $acf_type ] ) ) {
				continue; // tab / message / group / relationship / image / … → skipped
			}

			$field_name = (string) ( $field['name'] ?? $name );
			$field_key  = (string) ( $field['key'] ?? '' );

			// Hide-list filter (by ACF name OR key).
			if ( in_array( $field_name, $hide_list, true ) || ( '' !== $field_key && in_array( $field_key, $hide_list, true ) ) ) {
				continue;
			}

			// Grouped repeater (repeater whose rows each hold a nested options repeater):
			// expand into ONE add-on per outer row. OPT-IN (default off) so no store is
			// surprised; when off, a nested repeater falls through to the flat path below
			// exactly as before. Additive either way.
			if ( 'repeater' === $acf_type && self::grouped_enabled() && self::is_grouped_repeater( $field ) ) {
				foreach ( self::map_grouped_repeater( $field, $field_name, $product, $currency, $price_map ) as $grouped ) {
					if ( self::is_buyer_facing( $grouped, $price_map ) ) {
						$addons[] = $grouped;
					}
				}
				continue;
			}

			$addon = self::map_field( $field, $field_name, $acf_type, $product, $currency, $price_map );
			if ( null !== $addon && self::is_buyer_facing( $addon, $price_map ) ) {
				$addons[] = $addon;
			}
		}

		return $addons;
	}

	/**
	 * Is this add-on something a buyer should act on (vs. pure vendor metadata)?
	 *
	 * True when it is a CHOICE type (select/radio/checkbox) OR when it has a price
	 * attached — either via an option `price_modifier`, or via a merchant
	 * `agentmesh_addon_price_map` entry keyed by the field name. Non-choice free-form
	 * fields (text/number/boolean) with no price are dropped as vendor metadata.
	 */
	private static function is_buyer_facing( array $addon, array $price_map ): bool {
		$type = (string) ( $addon['type'] ?? '' );
		if ( in_array( $type, [ 'select', 'radio', 'checkbox' ], true ) ) {
			return true;
		}

		if ( isset( $addon['options'] ) && is_array( $addon['options'] ) ) {
			foreach ( $addon['options'] as $opt ) {
				if ( is_array( $opt ) && isset( $opt['price_modifier'] ) ) {
					return true;
				}
			}
		}

		$addon_id = (string) ( $addon['addon_id'] ?? '' );
		if ( '' !== $addon_id && isset( $price_map[ $addon_id ] ) ) {
			return true;
		}

		return false;
	}

	/** Opt-in: expand nested "grouped" repeaters into per-row add-ons. Default OFF. */
	private static function grouped_enabled(): bool {
		return self::truthy_option( get_option( 'agentmesh_addon_grouped_enabled', false ) );
	}

	/** A repeater is "grouped" when any of its sub-fields is itself a repeater. */
	private static function is_grouped_repeater( array $field ): bool {
		$subs = ( isset( $field['sub_fields'] ) && is_array( $field['sub_fields'] ) ) ? $field['sub_fields'] : [];
		foreach ( $subs as $sf ) {
			if ( is_array( $sf ) && 'repeater' === ( $sf['type'] ?? '' ) ) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Expand a grouped repeater (rows = selection groups, each with a nested options
	 * repeater) into one AMPSProductAddon per outer row. Each outer row's title becomes
	 * the add-on label; the nested rows become its priced options. Detection is by
	 * subfield role (text→label, number→price, name containing "discount"→sale price),
	 * so it tolerates the different field names used across stores.
	 *
	 * @return array AMPSProductAddon[]
	 */
	private static function map_grouped_repeater( array $field, string $field_name, WC_Product $product, string $currency, array $price_map ): array {
		$outer_subs = ( isset( $field['sub_fields'] ) && is_array( $field['sub_fields'] ) ) ? $field['sub_fields'] : [];
		$rows       = ( isset( $field['value'] ) && is_array( $field['value'] ) ) ? $field['value'] : [];

		// Generic: prefer a title-ish subfield name, else fall back to the first text subfield.
		// No store-specific field names — works for any "group title + options" repeater.
		$title_sub = self::pick_subfield( $outer_subs, [ 'title', 'name', 'label' ], [ 'text', 'textarea' ] );

		// The nested options repeater + its sub-fields.
		$nested = null;
		foreach ( $outer_subs as $sf ) {
			if ( is_array( $sf ) && 'repeater' === ( $sf['type'] ?? '' ) ) {
				$nested = $sf;
				break;
			}
		}
		if ( null === $nested ) {
			return [];
		}
		$nested_name = (string) ( $nested['name'] ?? '' );
		$inner_subs  = ( isset( $nested['sub_fields'] ) && is_array( $nested['sub_fields'] ) ) ? $nested['sub_fields'] : [];

		$label_sub = self::pick_subfield( $inner_subs, [ 'title', 'label', 'name' ], [ 'text', 'textarea' ] );
		$value_sub = self::pick_subfield( $inner_subs, [ 'value', 'slug' ], [] );
		$disc_sub  = self::pick_price_subfield( $inner_subs, true );   // discounted/sale
		$orig_sub  = self::pick_price_subfield( $inner_subs, false );  // original

		$multi_slugs = array_map( [ self::class, 'slugify' ], self::multi_groups() );

		$addons   = [];
		$used_ids = [];

		foreach ( $rows as $i => $row ) {
			if ( ! is_array( $row ) ) {
				continue;
			}
			$title = ( $title_sub && isset( $row[ $title_sub ] ) ) ? trim( (string) $row[ $title_sub ] ) : '';
			if ( '' === $title ) {
				continue;
			}

			// Stable, unique addon_id from the group title.
			$base_id = self::slugify( $title );
			$base_id = '' !== $base_id ? $base_id : $field_name . '_' . $i;
			$id      = $base_id;
			$n       = 2;
			while ( in_array( $id, $used_ids, true ) ) {
				$id = $base_id . '_' . $n;
				$n++;
			}
			$used_ids[] = $id;

			$opt_rows = ( '' !== $nested_name && isset( $row[ $nested_name ] ) && is_array( $row[ $nested_name ] ) ) ? $row[ $nested_name ] : [];
			$options  = [];

			foreach ( $opt_rows as $orow ) {
				if ( ! is_array( $orow ) ) {
					continue;
				}
				$olabel = ( $label_sub && isset( $orow[ $label_sub ] ) ) ? trim( (string) $orow[ $label_sub ] ) : '';
				if ( '' === $olabel ) {
					continue;
				}
				$ovalue = ( $value_sub && isset( $orow[ $value_sub ] ) && '' !== (string) $orow[ $value_sub ] )
					? self::slugify( (string) $orow[ $value_sub ] )
					: self::slugify( $olabel );

				// Discounted price wins when present and a positive number, else original.
				$price = null;
				if ( $disc_sub && isset( $orow[ $disc_sub ] ) && is_numeric( $orow[ $disc_sub ] ) && (float) $orow[ $disc_sub ] > 0 ) {
					$price = (float) $orow[ $disc_sub ];
				} elseif ( $orig_sub && isset( $orow[ $orig_sub ] ) && is_numeric( $orow[ $orig_sub ] ) ) {
					$price = (float) $orow[ $orig_sub ];
				}

				$option   = [ 'value' => $ovalue, 'label' => $olabel ];
				$modifier = self::resolve_option_price( $id, $ovalue, $olabel, $price, $product, $currency, $price_map );
				if ( null !== $modifier ) {
					$option['price_modifier'] = $modifier;
				}
				$options[] = $option;
			}

			if ( empty( $options ) ) {
				continue;
			}

			$is_multi = in_array( $id, $multi_slugs, true );
			$addons[] = [
				'addon_id' => $id,
				'label'    => $title,
				'type'     => $is_multi ? 'checkbox' : 'radio',
				'required' => false, // grouped rows aren't individually required in ACF
				'multiple' => $is_multi,
				'options'  => $options,
			];
		}

		return $addons;
	}

	/**
	 * Pick the price subfield from an inner options repeater. When $discounted is true,
	 * prefer a subfield whose name implies a sale price; otherwise prefer the plain
	 * price/cost/amount/fee subfield (skipping any discount-named one).
	 */
	private static function pick_price_subfield( array $sub_fields, bool $discounted ): ?string {
		foreach ( $sub_fields as $sf ) {
			$name = strtolower( (string) ( $sf['name'] ?? '' ) );
			if ( '' === $name ) {
				continue;
			}
			$is_disc  = ( false !== strpos( $name, 'discount' ) || false !== strpos( $name, 'sale' ) );
			$is_price = ( false !== strpos( $name, 'price' ) || false !== strpos( $name, 'cost' )
				|| false !== strpos( $name, 'amount' ) || false !== strpos( $name, 'fee' ) );
			if ( ! $is_price ) {
				continue;
			}
			if ( $discounted && $is_disc ) {
				return (string) $sf['name'];
			}
			if ( ! $discounted && ! $is_disc ) {
				return (string) $sf['name'];
			}
		}
		return null;
	}

	/**
	 * Merchant list of grouped add-on titles/ids to treat as multi-select (checkbox).
	 * Split on commas/newlines only — group titles contain spaces (e.g. "Cake Decorations").
	 */
	private static function multi_groups(): array {
		$raw  = get_option( 'agentmesh_addon_multi_groups', '' );
		$list = is_array( $raw ) ? $raw : ( preg_split( '/[\r\n,]+/', (string) $raw ) ?: [] );
		return array_values( array_filter( array_map( 'trim', $list ), fn( $s ) => '' !== $s ) );
	}

	/**
	 * Map one ACF field definition to an AMPSProductAddon (or null to skip).
	 */
	private static function map_field( array $field, string $field_name, string $acf_type, WC_Product $product, string $currency, array $price_map ): ?array {
		$label    = (string) ( $field['label'] ?? $field_name );
		$required = ! empty( $field['required'] );
		$help     = isset( $field['instructions'] ) && '' !== $field['instructions'] ? (string) $field['instructions'] : null;

		if ( 'repeater' === $acf_type ) {
			return self::map_repeater( $field, $field_name, $label, $required, $help, $product, $currency, $price_map );
		}

		$amps_type = self::TYPE_MAP[ $acf_type ];
		$multiple  = false;

		if ( 'select' === $acf_type && ! empty( $field['multiple'] ) ) {
			$amps_type = 'checkbox';
		}
		if ( 'checkbox' === $amps_type || 'checkbox' === $acf_type ) {
			$amps_type = 'checkbox';
			$multiple  = true;
		}

		$addon = [
			'addon_id' => $field_name,
			'label'    => $label,
			'type'     => $amps_type,
			'required' => $required,
			'multiple' => $multiple,
		];

		// Choice-based types carry options from ACF `choices`.
		if ( in_array( $amps_type, [ 'select', 'radio', 'checkbox' ], true ) ) {
			$addon['options'] = self::build_choice_options( $field, $field_name, $product, $currency, $price_map );
		}

		// A boolean add-on can still carry a single fixed fee (no ACF choices). Model it
		// as one option keyed "true" so it stays within the AMPSAddonOption[] contract and
		// validate_and_resolve can fold it in when the buyer toggles it on.
		if ( 'boolean' === $amps_type ) {
			$modifier = self::resolve_option_price( $field_name, 'true', null, null, $product, $currency, $price_map );
			if ( null !== $modifier ) {
				$addon['options'] = [ [ 'value' => 'true', 'label' => $label, 'price_modifier' => $modifier ] ];
			}
		}

		// Number types carry min/max.
		if ( 'number' === $amps_type ) {
			if ( isset( $field['min'] ) && '' !== $field['min'] && is_numeric( $field['min'] ) ) {
				$addon['min'] = (float) $field['min'];
			}
			if ( isset( $field['max'] ) && '' !== $field['max'] && is_numeric( $field['max'] ) ) {
				$addon['max'] = (float) $field['max'];
			}
		}

		if ( null !== $help ) {
			$addon['help'] = $help;
		}

		return $addon;
	}

	/**
	 * Build AMPSAddonOption[] from an ACF `choices` map, resolving a price modifier
	 * per option (map → `(+N)` label → free).
	 */
	private static function build_choice_options( array $field, string $field_name, WC_Product $product, string $currency, array $price_map ): array {
		$choices = ( isset( $field['choices'] ) && is_array( $field['choices'] ) ) ? $field['choices'] : [];
		$options = [];

		foreach ( $choices as $value => $raw_label ) {
			$value = (string) $value;
			$label = (string) $raw_label;

			$option = [
				'value' => $value,
				'label' => $label,
			];

			$modifier = self::resolve_option_price( $field_name, $value, $label, null, $product, $currency, $price_map );
			if ( null !== $modifier ) {
				$option['price_modifier'] = $modifier;
			}

			$options[] = $option;
		}

		return $options;
	}

	/**
	 * Map an ACF repeater to a single multi-select add-on whose rows are options.
	 */
	private static function map_repeater( array $field, string $field_name, string $label, bool $required, ?string $help, WC_Product $product, string $currency, array $price_map ): ?array {
		$sub_fields = ( isset( $field['sub_fields'] ) && is_array( $field['sub_fields'] ) ) ? $field['sub_fields'] : [];
		$rows       = ( isset( $field['value'] ) && is_array( $field['value'] ) ) ? $field['value'] : [];

		// Identify which subfield names drive label / value / price.
		$label_sub = self::pick_subfield( $sub_fields, [ 'label', 'name', 'title' ], [ 'text', 'textarea' ] );
		$value_sub = self::pick_subfield( $sub_fields, [ 'value', 'slug' ], [] );
		$price_sub = self::pick_subfield( $sub_fields, [ 'price', 'cost', 'amount', 'fee' ], [ 'number' ] );

		$options = [];
		foreach ( $rows as $row ) {
			if ( ! is_array( $row ) ) {
				continue;
			}

			$row_label = $label_sub && isset( $row[ $label_sub ] ) ? (string) $row[ $label_sub ] : '';
			if ( '' === $row_label ) {
				continue; // malformed/empty row → skip (non-fatal)
			}

			$row_value = ( $value_sub && isset( $row[ $value_sub ] ) && '' !== (string) $row[ $value_sub ] )
				? self::slugify( (string) $row[ $value_sub ] )
				: self::slugify( $row_label );

			$row_price = ( $price_sub && isset( $row[ $price_sub ] ) && is_numeric( $row[ $price_sub ] ) )
				? (float) $row[ $price_sub ]
				: null;

			$option = [
				'value' => $row_value,
				'label' => $row_label,
			];

			$modifier = self::resolve_option_price( $field_name, $row_value, $row_label, $row_price, $product, $currency, $price_map );
			if ( null !== $modifier ) {
				$option['price_modifier'] = $modifier;
			}

			$options[] = $option;
		}

		$addon = [
			'addon_id' => $field_name,
			'label'    => $label,
			'type'     => 'checkbox',
			'required' => $required,
			'multiple' => true, // documented assumption: repeaters default to multi-select
			'options'  => $options,
		];
		if ( null !== $help ) {
			$addon['help'] = $help;
		}

		return $addon;
	}

	// ─────────────────────────────────────────────────────────────────
	// Price resolution
	// ─────────────────────────────────────────────────────────────────

	/**
	 * Resolve a per-option/per-add-on price modifier as a MonetaryAmount, or null
	 * (free). Resolution order:
	 *   1. merchant price map (per-option amount, fixed amount, or referenced ACF field)
	 *   2. repeater row price subfield ($repeater_price)
	 *   3. `(+N)` / `(-N)` parsed from the choice label
	 *   4. free → null
	 *
	 * @param float|null $repeater_price Pre-extracted repeater subfield price (case 2).
	 */
	private static function resolve_option_price( string $addon_id, string $option_value, ?string $option_label, ?float $repeater_price, WC_Product $product, string $currency, array $price_map ): ?array {
		// (1) Merchant price map.
		if ( isset( $price_map[ $addon_id ] ) && is_array( $price_map[ $addon_id ] ) ) {
			$entry = $price_map[ $addon_id ];

			if ( isset( $entry['options'] ) && is_array( $entry['options'] ) && null !== $option_value
				&& isset( $entry['options'][ $option_value ] ) && is_numeric( $entry['options'][ $option_value ] ) ) {
				return self::monetary( (float) $entry['options'][ $option_value ], $currency );
			}

			if ( isset( $entry['price_field'] ) && '' !== (string) $entry['price_field'] ) {
				$ref = self::read_acf_value( (string) $entry['price_field'], $product );
				if ( is_numeric( $ref ) ) {
					return self::monetary( (float) $ref, $currency );
				}
			}

			if ( isset( $entry['amount'] ) && is_numeric( $entry['amount'] ) ) {
				return self::monetary( (float) $entry['amount'], $currency );
			}
		}

		// (2) Repeater row price subfield.
		if ( null !== $repeater_price ) {
			return self::monetary( $repeater_price, $currency );
		}

		// (3) `(+N)` / `(-N)` suffix in a choice label.
		if ( null !== $option_label ) {
			$parsed = self::parse_label_price( $option_label );
			if ( null !== $parsed ) {
				return self::monetary( $parsed, $currency );
			}
		}

		// (4) free.
		return null;
	}

	/**
	 * Parse a trailing `(+12)` / `(-5)` / `(+12.50)` price hint from a label.
	 * Returns the signed float or null when absent.
	 */
	private static function parse_label_price( string $label ): ?float {
		if ( preg_match( '/\(\s*([+\-])\s*([0-9]+(?:\.[0-9]+)?)\s*\)\s*$/', $label, $m ) ) {
			$sign = '-' === $m[1] ? -1.0 : 1.0;
			return $sign * (float) $m[2];
		}
		return null;
	}

	/**
	 * Read an ACF field value off the product by key or name. Tolerant of ACF being
	 * absent (returns null).
	 */
	private static function read_acf_value( string $field_ref, WC_Product $product ) {
		if ( function_exists( 'get_field' ) ) {
			$val = get_field( $field_ref, $product->get_id() );
			if ( null !== $val && '' !== $val ) {
				return $val;
			}
		}
		// Fallback: look the value up in the already-fetched field objects.
		if ( function_exists( 'get_field_objects' ) ) {
			$objs = get_field_objects( $product->get_id() );
			if ( is_array( $objs ) ) {
				foreach ( $objs as $name => $obj ) {
					if ( ! is_array( $obj ) ) {
						continue;
					}
					if ( $name === $field_ref || ( $obj['key'] ?? null ) === $field_ref || ( $obj['name'] ?? null ) === $field_ref ) {
						return $obj['value'] ?? null;
					}
				}
			}
		}
		return null;
	}

	// ─────────────────────────────────────────────────────────────────
	// validate_and_resolve_selection
	// ─────────────────────────────────────────────────────────────────

	/**
	 * Validate a buyer's selected add-ons against the product's add-on definitions and
	 * resolve the per-unit price modifier total.
	 *
	 * @param array $addons_def AMPSProductAddon[] from extract_addons().
	 * @param array $selected   Map of addon_id → string|string[]|bool|number from the client.
	 *
	 * @return array|WP_Error On success:
	 *   [ 'selected' => AMPSSelectedAddon[], 'modifier_total' => float, 'currency' => string ]
	 *   On failure a WP_Error whose `data['status']` is 422 and whose code is one of
	 *   ADDON_REQUIRED / ADDON_INVALID_OPTION / ADDON_OUT_OF_RANGE / ADDON_UNKNOWN.
	 */
	public static function validate_and_resolve_selection( array $addons_def, array $selected ) {
		$by_id = [];
		foreach ( $addons_def as $def ) {
			$by_id[ $def['addon_id'] ] = $def;
		}

		// Reject unknown addon_ids up front.
		foreach ( $selected as $addon_id => $_v ) {
			if ( ! isset( $by_id[ (string) $addon_id ] ) ) {
				return self::error( 'ADDON_UNKNOWN', sprintf( 'Unknown add-on "%s".', (string) $addon_id ) );
			}
		}

		$currency       = self::selection_currency( $addons_def );
		$resolved       = [];
		$modifier_total = 0.0;

		foreach ( $addons_def as $def ) {
			$addon_id   = $def['addon_id'];
			$type       = $def['type'];
			$required   = ! empty( $def['required'] );
			$has_value  = array_key_exists( $addon_id, $selected );
			$raw        = $has_value ? $selected[ $addon_id ] : null;

			if ( ! $has_value || self::is_empty_value( $raw ) ) {
				if ( $required ) {
					return self::error( 'ADDON_REQUIRED', sprintf( 'Add-on "%s" is required.', $addon_id ) );
				}
				continue; // optional + omitted → no line
			}

			switch ( $type ) {
				case 'select':
				case 'radio':
					$result = self::resolve_single_choice( $def, $raw );
					break;
				case 'checkbox':
					$result = self::resolve_multi_choice( $def, $raw );
					break;
				case 'boolean':
					$result = self::resolve_boolean( $def, $raw );
					break;
				case 'number':
					$result = self::resolve_number( $def, $raw );
					break;
				case 'text':
				default:
					$result = self::resolve_text( $def, $raw );
					break;
			}

			if ( $result instanceof WP_Error ) {
				return $result;
			}

			if ( null === $result ) {
				continue; // boolean false / empty → no line
			}

			$modifier_total += $result['_modifier'];

			$entry = [
				'addon_id' => $addon_id,
				'label'    => $def['label'],
				'value'    => $result['value'],
			];
			if ( 0.0 !== (float) $result['_modifier'] ) {
				$entry['price_modifier'] = self::monetary( (float) $result['_modifier'], $currency );
			}
			$resolved[] = $entry;
		}

		return [
			'selected'       => $resolved,
			'modifier_total' => $modifier_total,
			'currency'       => $currency,
		];
	}

	/** select / radio: value must be one of the options. */
	private static function resolve_single_choice( array $def, $raw ) {
		$value = is_array( $raw ) ? (string) reset( $raw ) : (string) $raw;
		$opt   = self::find_option( $def, $value );
		if ( null === $opt ) {
			return self::error( 'ADDON_INVALID_OPTION', sprintf( 'Invalid option "%s" for add-on "%s".', $value, $def['addon_id'] ) );
		}
		return [
			'value'     => $opt['value'],
			'_modifier' => self::option_modifier( $opt ),
		];
	}

	/** checkbox: every value ⊆ options. */
	private static function resolve_multi_choice( array $def, $raw ) {
		$values   = is_array( $raw ) ? $raw : [ $raw ];
		$out      = [];
		$modifier = 0.0;
		foreach ( $values as $v ) {
			$v   = (string) $v;
			$opt = self::find_option( $def, $v );
			if ( null === $opt ) {
				return self::error( 'ADDON_INVALID_OPTION', sprintf( 'Invalid option "%s" for add-on "%s".', $v, $def['addon_id'] ) );
			}
			$out[]    = $opt['value'];
			$modifier += self::option_modifier( $opt );
		}
		if ( empty( $out ) ) {
			return null;
		}
		return [ 'value' => $out, '_modifier' => $modifier ];
	}

	/** true_false: coerce to bool. False selections produce no line. */
	private static function resolve_boolean( array $def, $raw ) {
		$bool = filter_var( $raw, FILTER_VALIDATE_BOOLEAN );
		if ( ! $bool ) {
			return null;
		}
		// A boolean add-on may carry a single fixed fee, modelled as a "true" option.
		$opt      = self::find_option( $def, 'true' );
		$modifier = $opt ? self::option_modifier( $opt ) : 0.0;
		return [ 'value' => 'true', '_modifier' => $modifier ];
	}

	/** number: numeric + within min/max. */
	private static function resolve_number( array $def, $raw ) {
		if ( ! is_numeric( $raw ) ) {
			return self::error( 'ADDON_OUT_OF_RANGE', sprintf( 'Add-on "%s" expects a number.', $def['addon_id'] ) );
		}
		$num = (float) $raw;
		if ( isset( $def['min'] ) && $num < (float) $def['min'] ) {
			return self::error( 'ADDON_OUT_OF_RANGE', sprintf( 'Add-on "%s" below minimum (%s).', $def['addon_id'], $def['min'] ) );
		}
		if ( isset( $def['max'] ) && $num > (float) $def['max'] ) {
			return self::error( 'ADDON_OUT_OF_RANGE', sprintf( 'Add-on "%s" above maximum (%s).', $def['addon_id'], $def['max'] ) );
		}
		// A number value itself carries no modifier (unless a fixed price-map amount applies).
		$value = ( $num == (int) $num ) ? (string) (int) $num : (string) $num;
		return [ 'value' => $value, '_modifier' => 0.0 ];
	}

	/** text/textarea/email/url: sanitise + length cap. */
	private static function resolve_text( array $def, $raw ) {
		$text = is_array( $raw ) ? (string) reset( $raw ) : (string) $raw;
		if ( function_exists( 'sanitize_text_field' ) ) {
			$text = sanitize_text_field( $text );
		}
		if ( strlen( $text ) > self::TEXT_MAX_LEN ) {
			$text = substr( $text, 0, self::TEXT_MAX_LEN );
		}
		if ( '' === $text ) {
			return null;
		}
		return [ 'value' => $text, '_modifier' => 0.0 ];
	}

	// ─────────────────────────────────────────────────────────────────
	// order_to_amps helper — read selected add-ons off order-item meta
	// ─────────────────────────────────────────────────────────────────

	/**
	 * Reconstruct AMPSSelectedAddon[] from the JSON blob the checkout stamps on each
	 * order line item. Returns [] when no add-ons were recorded.
	 */
	public static function addons_from_order_item( $item ): array {
		$raw = method_exists( $item, 'get_meta' ) ? $item->get_meta( '_agentmesh_addons' ) : '';
		if ( empty( $raw ) ) {
			return [];
		}
		$decoded = is_string( $raw ) ? json_decode( $raw, true ) : $raw;
		return is_array( $decoded ) ? $decoded : [];
	}

	// ─────────────────────────────────────────────────────────────────
	// Small helpers
	// ─────────────────────────────────────────────────────────────────

	private static function find_option( array $def, string $value ): ?array {
		foreach ( $def['options'] ?? [] as $opt ) {
			if ( (string) $opt['value'] === $value ) {
				return $opt;
			}
		}
		return null;
	}

	private static function option_modifier( array $opt ): float {
		return isset( $opt['price_modifier']['amount'] ) ? (float) $opt['price_modifier']['amount'] : 0.0;
	}

	private static function is_empty_value( $v ): bool {
		if ( null === $v ) {
			return true;
		}
		if ( is_array( $v ) ) {
			return 0 === count( array_filter( $v, fn( $x ) => '' !== (string) $x ) );
		}
		if ( is_bool( $v ) ) {
			return false; // false is a meaningful boolean answer, not "empty"
		}
		return '' === (string) $v;
	}

	private static function monetary( float $amount, string $currency ): array {
		return [ 'amount' => number_format( $amount, 2, '.', '' ), 'currency' => $currency ];
	}

	private static function selection_currency( array $addons_def ): string {
		foreach ( $addons_def as $def ) {
			foreach ( $def['options'] ?? [] as $opt ) {
				if ( isset( $opt['price_modifier']['currency'] ) ) {
					return $opt['price_modifier']['currency'];
				}
			}
		}
		return function_exists( 'get_woocommerce_currency' ) ? get_woocommerce_currency() : 'USD';
	}

	/**
	 * Pick the first subfield (returning its `name`) whose name matches a preferred
	 * name, else the first whose type is one of $preferred_types, else the first
	 * subfield overall (for label) — caller decides fallback.
	 */
	private static function pick_subfield( array $sub_fields, array $preferred_names, array $preferred_types ): ?string {
		// Preferred names first.
		foreach ( $sub_fields as $sf ) {
			$n = (string) ( $sf['name'] ?? '' );
			if ( '' !== $n && in_array( strtolower( $n ), $preferred_names, true ) ) {
				return $n;
			}
		}
		// Preferred types next.
		if ( ! empty( $preferred_types ) ) {
			foreach ( $sub_fields as $sf ) {
				if ( in_array( (string) ( $sf['type'] ?? '' ), $preferred_types, true ) ) {
					return (string) ( $sf['name'] ?? '' ) ?: null;
				}
			}
			// For label, fall back to the very first subfield.
			if ( in_array( 'text', $preferred_types, true ) || in_array( 'textarea', $preferred_types, true ) ) {
				$first = $sub_fields[0] ?? null;
				if ( is_array( $first ) && ! empty( $first['name'] ) ) {
					return (string) $first['name'];
				}
			}
		}
		return null;
	}

	private static function slugify( string $text ): string {
		if ( function_exists( 'sanitize_title' ) ) {
			$slug = sanitize_title( $text );
			if ( '' !== $slug ) {
				return $slug;
			}
		}
		$slug = strtolower( trim( $text ) );
		$slug = preg_replace( '/[^a-z0-9]+/', '-', $slug );
		return trim( (string) $slug, '-' );
	}

	private static function truthy_option( $val ): bool {
		if ( is_bool( $val ) ) {
			return $val;
		}
		return in_array( strtolower( (string) $val ), [ '1', 'yes', 'true', 'on' ], true );
	}

	/** @return string[] */
	private static function hidden_fields(): array {
		$raw = get_option( 'agentmesh_addon_hidden_fields', '' );
		if ( is_array( $raw ) ) {
			$list = $raw;
		} else {
			$list = preg_split( '/[\s,]+/', (string) $raw ) ?: [];
		}
		return array_values( array_filter( array_map( 'trim', $list ), fn( $s ) => '' !== $s ) );
	}

	/** @return array<string,array> */
	private static function price_map(): array {
		$raw = get_option( 'agentmesh_addon_price_map', '' );
		if ( is_array( $raw ) ) {
			return $raw;
		}
		$raw = trim( (string) $raw );
		if ( '' === $raw ) {
			return [];
		}
		$decoded = json_decode( $raw, true );
		return is_array( $decoded ) ? $decoded : [];
	}

	private static function error( string $code, string $message ): WP_Error {
		return new WP_Error( $code, $message, [ 'status' => 422 ] );
	}
}
