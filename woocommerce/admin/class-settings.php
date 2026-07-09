<?php
/**
 * Admin Settings — WooCommerce Settings tab for Synchronity.
 */

defined( 'ABSPATH' ) || exit;

require_once __DIR__ . '/class-acf-source.php';
require_once __DIR__ . '/class-price-map.php';

class AgentMesh_Settings {

	public function __construct() {
		add_filter( 'woocommerce_settings_tabs_array', [ $this, 'add_settings_tab' ], 50 );
		add_action( 'woocommerce_settings_tabs_agentmesh', [ $this, 'output_settings' ] );
		add_action( 'woocommerce_update_options_agentmesh', [ $this, 'save_settings' ] );
		add_action( 'woocommerce_settings_tabs_agentmesh', [ $this, 'maybe_generate_site_id' ] );
		// Custom field type that renders the Generate + Copy buttons under the Connector Key input.
		add_action( 'woocommerce_admin_field_agentmesh_key_actions', [ $this, 'render_key_actions' ] );
		// Assisted add-on pickers (custom field types rendered below).
		add_action( 'woocommerce_admin_field_agentmesh_price_map_builder', [ $this, 'render_price_map_builder' ] );
		add_action( 'woocommerce_admin_field_agentmesh_field_multiselect', [ $this, 'render_field_multiselect' ] );
		add_action( 'woocommerce_admin_field_agentmesh_price_source_select', [ $this, 'render_price_source_select' ] );
		// AJAX endpoint that mints a new key, pushes it to the gateway (when linked), and persists it.
		add_action( 'wp_ajax_agentmesh_rotate_key', [ $this, 'ajax_rotate_key' ] );
	}

	public function add_settings_tab( array $tabs ): array {
		$tabs['agentmesh'] = __( 'Synchronity', 'agentmesh-woocommerce' );
		return $tabs;
	}

	public function output_settings(): void {
		// Assisted-picker UI for the add-on settings. Only enqueued on this tab.
		wp_enqueue_style(
			'agentmesh-addon-settings',
			AGENTMESH_PLUGIN_URL . 'admin/css/addon-settings.css',
			[],
			AGENTMESH_VERSION
		);
		wp_enqueue_script(
			'agentmesh-addon-settings',
			AGENTMESH_PLUGIN_URL . 'admin/js/addon-settings.js',
			[],
			AGENTMESH_VERSION,
			true
		);
		WC_Admin_Settings::output_fields( $this->get_settings() );
	}

	public function save_settings(): void {
		// Verify settings page nonce.
		// phpcs:ignore WordPress.Security.NonceVerification.Missing
		if ( ! isset( $_POST['_wpnonce'] ) || ! wp_verify_nonce( sanitize_key( $_POST['_wpnonce'] ), 'woocommerce-settings' ) ) {
			return;
		}

		WC_Admin_Settings::save_fields( $this->get_settings() );

		// The custom add-on field types below are not handled by save_fields().

		// Price map: the hidden input carries JSON serialized by the builder JS.
		// phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized
		if ( isset( $_POST['agentmesh_addon_price_map'] ) ) {
			// phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized
			$raw     = wp_unslash( $_POST['agentmesh_addon_price_map'] );
			$decoded = json_decode( (string) $raw, true );
			if ( is_array( $decoded ) ) {
				$sanitized = [];
				foreach ( $decoded as $field => $cfg ) {
					$clean_field = sanitize_text_field( $field );
					if ( is_array( $cfg ) ) {
						$clean_cfg = [];
						if ( isset( $cfg['amount'] ) ) {
							$clean_cfg['amount'] = sanitize_text_field( $cfg['amount'] );
						}
						if ( isset( $cfg['options'] ) && is_array( $cfg['options'] ) ) {
							$clean_opts = [];
							foreach ( $cfg['options'] as $v => $a ) {
								$clean_opts[ sanitize_text_field( $v ) ] = sanitize_text_field( $a );
							}
							$clean_cfg['options'] = $clean_opts;
						}
						if ( isset( $cfg['price_field'] ) ) {
							$clean_cfg['price_field'] = sanitize_text_field( $cfg['price_field'] );
						}
						$sanitized[ $clean_field ] = $clean_cfg;
					}
				}
				update_option( 'agentmesh_addon_price_map', wp_json_encode( $sanitized ) );
			} else {
				update_option( 'agentmesh_addon_price_map', '' );
			}
		}

		// Multiselects post arrays; store as comma-joined CSV (read side splits on comma/newline).
		foreach ( [ 'agentmesh_addon_hidden_fields', 'agentmesh_addon_multi_groups' ] as $opt ) {
			// phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized
			$vals  = isset( $_POST[ $opt ] ) ? (array) wp_unslash( $_POST[ $opt ] ) : [];
			$clean = [];
			foreach ( $vals as $val ) {
				$clean[] = sanitize_text_field( $val );
			}
			$clean = array_values( array_filter( $clean, 'strlen' ) );
			update_option( $opt, implode( ', ', $clean ) );
		}

		// phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized
		if ( isset( $_POST['agentmesh_product_price_field'] ) ) {
			// phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized
			update_option( 'agentmesh_product_price_field', sanitize_text_field( wp_unslash( $_POST['agentmesh_product_price_field'] ) ) );
		}
	}

	/**
	 * Auto-generate a site ID on first load if one doesn't exist.
	 */
	public function maybe_generate_site_id(): void {
		if ( ! get_option( 'agentmesh_site_id' ) ) {
			update_option( 'agentmesh_site_id', 'site_' . bin2hex( random_bytes( 8 ) ) );
		}
	}

	public function get_settings(): array {
		return [
			[
				'title' => __( 'Synchronity Settings', 'agentmesh-woocommerce' ),
				'type'  => 'title',
				'desc'  => __( 'Connect your WooCommerce store to the Synchronity network.', 'agentmesh-woocommerce' ),
				'id'    => 'agentmesh_settings_section',
			],

			[
				'title'   => __( 'Enable Synchronity', 'agentmesh-woocommerce' ),
				'type'    => 'checkbox',
				'desc'    => __( 'Enable the Synchronity connector API on this store.', 'agentmesh-woocommerce' ),
				'id'      => 'agentmesh_enabled',
				'default' => 'yes',
			],

			[
				'title'       => __( 'Gateway URL', 'agentmesh-woocommerce' ),
				'type'        => 'url',
				'desc'        => __( 'The base URL of your Synchronity Gateway instance (e.g. https://api.synchronity.app).', 'agentmesh-woocommerce' ),
				'id'          => 'agentmesh_gateway_url',
				'default'     => 'https://api.synchronity.app',
				'placeholder' => 'https://api.synchronity.app',
				'css'         => 'min-width:350px;',
			],

			[
				'title'       => __( 'Connector Key', 'agentmesh-woocommerce' ),
				'type'        => 'password',
				'desc'        => __( 'The shared secret key the Gateway uses to authenticate requests to this connector. Click "Generate new key" to mint a new one — when the store is already linked, the new key is pushed to Synchronity automatically.', 'agentmesh-woocommerce' ),
				'id'          => 'agentmesh_connector_key',
				'placeholder' => 'amck_...',
				'css'         => 'min-width:350px;',
			],

			[
				// Renders Generate + Copy buttons below the Connector Key. No persistence on this row.
				'type' => 'agentmesh_key_actions',
				'id'   => 'agentmesh_connector_key_actions',
			],

			[
				'title' => __( 'Site ID', 'agentmesh-woocommerce' ),
				'type'  => 'text',
				'desc'  => __( 'Your Synchronity-assigned site identifier. Auto-generated if empty.', 'agentmesh-woocommerce' ),
				'id'    => 'agentmesh_site_id',
				'css'   => 'min-width:350px;',
			],

			[
				'title' => __( 'Permissions', 'agentmesh-woocommerce' ),
				'type'  => 'title',
				'id'    => 'agentmesh_permissions_section',
			],

			[
				'title'   => __( 'Allow Cart Management', 'agentmesh-woocommerce' ),
				'type'    => 'checkbox',
				'desc'    => __( 'Allow AI agents to create and manage cart sessions on this store.', 'agentmesh-woocommerce' ),
				'id'      => 'agentmesh_allow_cart',
				'default' => 'yes',
			],

			[
				'title'   => __( 'Allow Checkout Execution', 'agentmesh-woocommerce' ),
				'type'    => 'checkbox',
				'desc'    => __( 'Allow AI agents to place orders on behalf of users via delegation tokens.', 'agentmesh-woocommerce' ),
				'id'      => 'agentmesh_allow_checkout',
				'default' => 'yes',
			],

			[
				'title'   => __( 'Read-Only Mode', 'agentmesh-woocommerce' ),
				'type'    => 'checkbox',
				'desc'    => __( 'Restrict the connector to product and manifest reads only. Disables cart and checkout.', 'agentmesh-woocommerce' ),
				'id'      => 'agentmesh_read_only',
				'default' => 'no',
			],

			[
				'title' => __( 'Inline Payments (Paystack)', 'agentmesh-woocommerce' ),
				'type'  => 'title',
				'desc'  => __( 'Let AI agents initiate and complete payment inside the chat. Paystack keys are read from your Paystack for WooCommerce plugin settings when present.', 'agentmesh-woocommerce' ),
				'id'    => 'agentmesh_payments_section',
			],

			[
				'title'   => __( 'Enable Mobile Money', 'agentmesh-woocommerce' ),
				'type'    => 'checkbox',
				'desc'    => __( 'Offer in-chat mobile money payments (MTN, Vodafone, AirtelTigo). Requires a GHS store currency.', 'agentmesh-woocommerce' ),
				'id'      => 'agentmesh_payment_enable_mobile_money',
				'default' => 'yes',
			],

			[
				'title'   => __( 'Enable Card', 'agentmesh-woocommerce' ),
				'type'    => 'checkbox',
				'desc'    => __( 'Offer card payments via a Paystack-hosted secure page (no card details touch the chat).', 'agentmesh-woocommerce' ),
				'id'      => 'agentmesh_payment_enable_card',
				'default' => 'yes',
			],

			[
				'title'    => __( 'Paystack Webhook URL', 'agentmesh-woocommerce' ),
				'type'     => 'text',
				'desc'     => __( 'Paste this URL into your Paystack dashboard (Settings → API Keys & Webhooks → Webhook URL) so payments confirm automatically.', 'agentmesh-woocommerce' ),
				'id'       => 'agentmesh_paystack_webhook_url_display',
				'value'    => $this->get_paystack_webhook_url(),
				'custom_attributes' => [ 'readonly' => 'readonly' ],
				'css'      => 'min-width:450px;background:#f6f7f7;',
			],

			[
				'type' => 'sectionend',
				'id'   => 'agentmesh_payments_section',
			],

			[
				'title' => __( 'Inline Payments (Stripe)', 'agentmesh-woocommerce' ),
				'type'  => 'title',
				'desc'  => __( 'Let AI agents pay by card via a Stripe-hosted secure page. Stripe keys are read automatically from your Stripe for WooCommerce plugin — nothing to enter here.', 'agentmesh-woocommerce' ),
				'id'    => 'agentmesh_stripe_section',
			],

			[
				'title'   => __( 'Enable Stripe', 'agentmesh-woocommerce' ),
				'type'    => 'checkbox',
				'desc'    => __( 'Offer card payments via a Stripe-hosted secure page (no card details touch the chat).', 'agentmesh-woocommerce' ),
				'id'      => 'agentmesh_payment_enable_stripe',
				'default' => 'no',
			],

			[
				'title'    => __( 'Stripe Webhook URL', 'agentmesh-woocommerce' ),
				'type'     => 'text',
				'desc'     => __( 'Add this URL as a Stripe webhook endpoint (events: checkout.session.completed, checkout.session.expired), then paste its signing secret below.', 'agentmesh-woocommerce' ),
				'id'       => 'agentmesh_stripe_webhook_url_display',
				'value'    => $this->get_stripe_webhook_url(),
				'custom_attributes' => [ 'readonly' => 'readonly' ],
				'css'      => 'min-width:450px;background:#f6f7f7;',
			],

			[
				'title'   => __( 'Stripe Webhook Signing Secret', 'agentmesh-woocommerce' ),
				'type'    => 'password',
				'desc'    => __( 'Optional. Stripe webhook signing secret (whsec_…). Leave blank to rely on payment-status polling; provide it for faster webhook-driven confirmation.', 'agentmesh-woocommerce' ),
				'id'      => 'agentmesh_stripe_webhook_secret',
				'default' => '',
			],

			[
				'type' => 'sectionend',
				'id'   => 'agentmesh_stripe_section',
			],

			[
				'title' => __( 'Inline Payments (PayPal)', 'agentmesh-woocommerce' ),
				'type'  => 'title',
				'desc'  => __( 'Let AI agents pay via a PayPal-hosted secure page (PayPal balance or guest card). Credentials are read automatically from your WooCommerce PayPal Payments plugin when present.', 'agentmesh-woocommerce' ),
				'id'    => 'agentmesh_paypal_section',
			],

			[
				'title'   => __( 'Enable PayPal', 'agentmesh-woocommerce' ),
				'type'    => 'checkbox',
				'desc'    => __( 'Offer PayPal payments via a PayPal-hosted secure page (no card details touch the chat). Shown only for PayPal-supported currencies.', 'agentmesh-woocommerce' ),
				'id'      => 'agentmesh_payment_enable_paypal',
				'default' => 'no',
			],

			[
				'title'    => __( 'PayPal Webhook URL', 'agentmesh-woocommerce' ),
				'type'     => 'text',
				'desc'     => __( 'Add this URL as a webhook in your PayPal developer dashboard (events: PAYMENT.CAPTURE.COMPLETED, PAYMENT.CAPTURE.DENIED), then paste its Webhook ID below.', 'agentmesh-woocommerce' ),
				'id'       => 'agentmesh_paypal_webhook_url_display',
				'value'    => $this->get_paypal_webhook_url(),
				'custom_attributes' => [ 'readonly' => 'readonly' ],
				'css'      => 'min-width:450px;background:#f6f7f7;',
			],

			[
				'title'   => __( 'PayPal Webhook ID', 'agentmesh-woocommerce' ),
				'type'    => 'text',
				'desc'    => __( 'Optional. The Webhook ID from your PayPal app (Webhooks). Leave blank to rely on payment-status polling; provide it for faster webhook-driven confirmation.', 'agentmesh-woocommerce' ),
				'id'      => 'agentmesh_paypal_webhook_id',
				'default' => '',
			],

			[
				'type' => 'sectionend',
				'id'   => 'agentmesh_paypal_section',
			],

			// ── Product Add-ons (ACF) ───────────────────────────────────
			[
				'title' => __( 'Product Add-ons (ACF)', 'agentmesh-woocommerce' ),
				'type'  => 'title',
				'desc'  => $this->addons_section_desc(),
				'id'    => 'agentmesh_addons_section',
			],

			[
				'title'   => __( 'Enable Product Add-ons', 'agentmesh-woocommerce' ),
				'type'    => 'checkbox',
				'desc'    => __( 'Surface per-product options defined with Advanced Custom Fields (ACF) so AI agents can collect a buyer\'s choices. Requires the ACF plugin.', 'agentmesh-woocommerce' ),
				'id'      => 'agentmesh_addons_enabled',
				'default' => 'yes',
			],

			[
				'title'   => __( 'Enable Grouped (Nested) Add-ons', 'agentmesh-woocommerce' ),
				'type'    => 'checkbox',
				'desc'    => __( 'Off by default. Enable only if this store builds product options as a NESTED ACF repeater (an outer repeater of groups, each with an inner repeater of priced options). When on, each outer row becomes its own add-on. Leave off for normal single fields / flat repeaters.', 'agentmesh-woocommerce' ),
				'id'      => 'agentmesh_addon_grouped_enabled',
				'default' => 'no',
			],

			[
				'title'      => __( 'Hidden Add-on Fields', 'agentmesh-woocommerce' ),
				'type'       => 'agentmesh_field_multiselect',
				'desc'       => __( 'Select ACF fields to hide from add-ons (e.g. internal fields). Matching fields are never exposed.', 'agentmesh-woocommerce' ),
				'id'         => 'agentmesh_addon_hidden_fields',
				'agm_source' => 'fields',
			],

			[
				'title'    => __( 'Add-on Price Map', 'agentmesh-woocommerce' ),
				'type'     => 'agentmesh_price_map_builder',
				'desc'     => __(
					'Optional. Attach a fee to each priced add-on field: a fixed per-unit fee, a fee per option value, or read the fee from another ACF field. '
					. 'Amounts are in the store currency. Unmapped add-ons fall back to a repeater price subfield, a <code>(+N)</code>/<code>(-N)</code> label suffix, or free.',
					'agentmesh-woocommerce'
				),
				'id'       => 'agentmesh_addon_price_map',
			],

			[
				'title'   => __( 'Add-on Pricing Mode', 'agentmesh-woocommerce' ),
				'type'    => 'select',
				'desc'    => __( '"Additive" (default): add-on prices are added on top of the product price. "Absolute": the line price is the sum of the selected option prices and the product base price is ignored — for builder/configurator products whose base price is just a placeholder.', 'agentmesh-woocommerce' ),
				'id'      => 'agentmesh_addon_pricing_mode',
				'default' => 'additive',
				'options' => [
					'additive' => __( 'Additive (base + add-ons)', 'agentmesh-woocommerce' ),
					'absolute' => __( 'Absolute (sum of selected options)', 'agentmesh-woocommerce' ),
				],
			],

			[
				'title' => __( 'Product price source', 'agentmesh-woocommerce' ),
				'type'  => 'agentmesh_price_source_select',
				'desc'  => __( 'Optional. ACF field holding the consumer/display price (e.g. non_price). Takes effect once consumer pricing is enabled; until then the WooCommerce price is used.', 'agentmesh-woocommerce' ),
				'id'    => 'agentmesh_product_price_field',
			],

			[
				'title'      => __( 'Multi-select Add-on Groups', 'agentmesh-woocommerce' ),
				'type'       => 'agentmesh_field_multiselect',
				'desc'       => __( 'Select add-on group titles that allow choosing MORE THAN ONE option (e.g. "Extra Toppings"). All other groups are single-choice. Applies to grouped (nested-repeater) add-ons.', 'agentmesh-woocommerce' ),
				'id'         => 'agentmesh_addon_multi_groups',
				'agm_source' => 'groups',
			],

			[
				'type' => 'sectionend',
				'id'   => 'agentmesh_addons_section',
			],

			[
				'type' => 'sectionend',
				'id'   => 'agentmesh_settings_section',
			],
		];
	}

	/**
	 * Section description; warns (read-only note) when ACF is not detected.
	 */
	private function addons_section_desc(): string {
		if ( ! function_exists( 'get_field_objects' ) ) {
			return __( 'Advanced Custom Fields (ACF) was not detected on this site. Product add-ons are inactive until ACF is installed and active — the settings below have no effect.', 'agentmesh-woocommerce' );
		}
		return __( 'Expose ACF-defined product options to AI agents as purchasable add-ons. Choices, requirements, and optional price modifiers carry through cart and checkout onto the order.', 'agentmesh-woocommerce' );
	}

	/**
	 * Render the assisted price-map builder. The hidden input carries the JSON
	 * the builder JS keeps in sync; a collapsed textarea allows raw JSON editing.
	 */
	public function render_price_map_builder( array $field ): void {
		$json   = (string) get_option( 'agentmesh_addon_price_map', '' );
		$rows   = AgentMesh_Price_Map::json_to_rows( $json );
		$fields = AgentMesh_ACF_Source::addon_fields();
		$desc   = isset( $field['desc'] ) ? (string) $field['desc'] : '';
		?>
		<tr valign="top">
			<th scope="row" class="titledesc"><?php echo esc_html( $field['title'] ?? '' ); ?></th>
			<td class="forminp">
				<div
					id="agm-pricemap"
					data-fields="<?php echo esc_attr( wp_json_encode( $fields ) ); ?>"
					data-rows="<?php echo esc_attr( wp_json_encode( $rows ) ); ?>"
				></div>
				<input type="hidden" id="agm-pricemap-json" name="agentmesh_addon_price_map" value="<?php echo esc_attr( $json ); ?>">
				<p><a href="#" id="agm-pricemap-toggle"><?php echo esc_html__( 'Edit as JSON', 'agentmesh-woocommerce' ); ?></a></p>
				<textarea id="agm-pricemap-raw" style="display:none;min-width:450px;height:120px;font-family:monospace;"><?php echo esc_textarea( $json ); ?></textarea>
				<?php if ( '' !== $desc ) : ?>
					<p class="description"><?php echo wp_kses_post( $desc ); ?></p>
				<?php endif; ?>
			</td>
		</tr>
		<?php
	}

	/**
	 * Render a multi-select for either ACF add-on fields or grouped-add-on titles.
	 * Stale current values not present in the option list are preserved as
	 * pre-selected options.
	 */
	public function render_field_multiselect( array $field ): void {
		$id     = (string) ( $field['id'] ?? '' );
		$source = $field['agm_source'] ?? 'fields';

		// [ value => label ] option list.
		$options = [];
		if ( 'groups' === $source ) {
			foreach ( AgentMesh_ACF_Source::grouped_group_titles() as $title ) {
				$options[ (string) $title ] = (string) $title;
			}
		} else {
			foreach ( AgentMesh_ACF_Source::addon_fields() as $f ) {
				$options[ (string) $f['name'] ] = sprintf( '%s (%s)', $f['label'], $f['name'] );
			}
		}

		// Current CSV value -> trimmed list.
		$current_raw = (string) get_option( $id, '' );
		$current     = array_values( array_filter( array_map( 'trim', preg_split( '/[,\n\r]+/', $current_raw ) ), 'strlen' ) );

		// Preserve stale entries not in the option list.
		foreach ( $current as $val ) {
			if ( ! isset( $options[ $val ] ) ) {
				$options[ $val ] = $val;
			}
		}

		$show_group_note = ( 'groups' === $source ) && ! get_option( 'agentmesh_addon_grouped_enabled' );
		?>
		<tr valign="top">
			<th scope="row" class="titledesc"><?php echo esc_html( $field['title'] ?? '' ); ?></th>
			<td class="forminp">
				<select multiple name="<?php echo esc_attr( $id ); ?>[]" style="min-width:450px;min-height:120px;">
					<?php foreach ( $options as $value => $label ) : ?>
						<option value="<?php echo esc_attr( $value ); ?>" <?php selected( in_array( (string) $value, $current, true ) ); ?>><?php echo esc_html( $label ); ?></option>
					<?php endforeach; ?>
				</select>
				<?php if ( ! empty( $field['desc'] ) ) : ?>
					<p class="description"><?php echo wp_kses_post( $field['desc'] ); ?></p>
				<?php endif; ?>
				<?php if ( $show_group_note ) : ?>
					<p class="description"><?php echo esc_html__( 'Only applies when Grouped Add-ons is enabled.', 'agentmesh-woocommerce' ); ?></p>
				<?php endif; ?>
			</td>
		</tr>
		<?php
	}

	/**
	 * Render the product price-source select (capture-only — read side decides use).
	 */
	public function render_price_source_select( array $field ): void {
		$current = (string) get_option( 'agentmesh_product_price_field', '' );
		?>
		<tr valign="top">
			<th scope="row" class="titledesc"><?php echo esc_html( $field['title'] ?? '' ); ?></th>
			<td class="forminp">
				<select name="agentmesh_product_price_field">
					<option value=""><?php echo esc_html__( '— WooCommerce price (default) —', 'agentmesh-woocommerce' ); ?></option>
					<?php
					foreach ( AgentMesh_ACF_Source::addon_fields() as $f ) {
						if ( ! in_array( $f['type'], [ 'number', 'text' ], true ) ) {
							continue;
						}
						printf(
							'<option value="%s" %s>%s</option>',
							esc_attr( $f['name'] ),
							selected( $current, $f['name'], false ),
							esc_html( sprintf( '%s (%s)', $f['label'], $f['name'] ) )
						);
					}
					?>
				</select>
				<?php if ( ! empty( $field['desc'] ) ) : ?>
					<p class="description"><?php echo wp_kses_post( $field['desc'] ); ?></p>
				<?php endif; ?>
			</td>
		</tr>
		<?php
	}

	/**
	 * The connector-owned Paystack webhook URL the merchant must register in
	 * their Paystack dashboard. Read-only display only.
	 */
	private function get_paystack_webhook_url(): string {
		$base = function_exists( 'get_rest_url' )
			? get_rest_url( null, AGENTMESH_REST_NAMESPACE . '/webhooks/paystack' )
			: trailingslashit( get_site_url() ) . 'wp-json/' . AGENTMESH_REST_NAMESPACE . '/webhooks/paystack';
		return $base;
	}

	/**
	 * The connector-owned Stripe webhook URL the merchant registers in their
	 * Stripe dashboard (events: checkout.session.completed, checkout.session.expired).
	 */
	private function get_stripe_webhook_url(): string {
		$base = function_exists( 'get_rest_url' )
			? get_rest_url( null, AGENTMESH_REST_NAMESPACE . '/webhooks/stripe' )
			: trailingslashit( get_site_url() ) . 'wp-json/' . AGENTMESH_REST_NAMESPACE . '/webhooks/stripe';
		return $base;
	}

	/**
	 * The connector-owned PayPal webhook URL the merchant registers in their
	 * PayPal developer dashboard (events: PAYMENT.CAPTURE.COMPLETED/DENIED).
	 */
	private function get_paypal_webhook_url(): string {
		$base = function_exists( 'get_rest_url' )
			? get_rest_url( null, AGENTMESH_REST_NAMESPACE . '/webhooks/paypal' )
			: trailingslashit( get_site_url() ) . 'wp-json/' . AGENTMESH_REST_NAMESPACE . '/webhooks/paypal';
		return $base;
	}

	/**
	 * Render the Generate + Copy buttons below the Connector Key input.
	 *
	 * Generate kicks off an AJAX call to {@see ajax_rotate_key()}, which:
	 *   1. Mints a new key server-side.
	 *   2. If the store is already linked (current key + gateway URL + site_id all present),
	 *      pushes the new key to the gateway authenticated by the OLD key. Only persists
	 *      locally on a 200 from the gateway — keeps the two sides in sync.
	 *   3. If not yet linked, just persists locally; the merchant pastes into the dashboard
	 *      to complete initial setup.
	 *
	 * Copy is a pure client-side clipboard helper.
	 */
	public function render_key_actions(): void {
		$gen_label   = esc_html__( 'Generate new key', 'agentmesh-woocommerce' );
		$copy_label  = esc_html__( 'Copy', 'agentmesh-woocommerce' );
		$default_msg = __( 'Click "Generate new key" to mint a fresh key. When this store is already linked to Synchronity, it will be pushed to the gateway automatically.', 'agentmesh-woocommerce' );
		$nonce       = wp_create_nonce( 'agentmesh_rotate_key' );
		$ajax_url    = esc_url_raw( admin_url( 'admin-ajax.php' ) );
		?>
		<tr valign="top">
			<th scope="row" class="titledesc">&nbsp;</th>
			<td class="forminp">
				<button type="button" class="button" id="agentmesh_generate_key"><?php echo esc_html( $gen_label ); ?></button>
				<button type="button" class="button" id="agentmesh_copy_key"><?php echo esc_html( $copy_label ); ?></button>
				<p class="description" id="agentmesh_key_feedback"><?php echo esc_html( $default_msg ); ?></p>
			</td>
		</tr>
		<script>
		(function () {
			var input   = document.getElementById('agentmesh_connector_key');
			var gen     = document.getElementById('agentmesh_generate_key');
			var cpy     = document.getElementById('agentmesh_copy_key');
			var fb      = document.getElementById('agentmesh_key_feedback');
			var ajaxUrl = <?php echo wp_json_encode( $ajax_url ); ?>;
			var nonce   = <?php echo wp_json_encode( $nonce ); ?>;
			if (!input || !gen || !cpy || !fb) return;

			function setMsg(msg, kind) {
				fb.textContent = msg;
				fb.style.color = kind === 'ok' ? '#1e7e34' : (kind === 'warn' ? '#a94442' : '');
			}

			gen.addEventListener('click', function (e) {
				e.preventDefault();
				gen.disabled = true;
				setMsg(<?php echo wp_json_encode( __( 'Generating…', 'agentmesh-woocommerce' ) ); ?>, '');
				var body = new URLSearchParams();
				body.set('action', 'agentmesh_rotate_key');
				body.set('_wpnonce', nonce);
				fetch(ajaxUrl, { method: 'POST', credentials: 'same-origin', body: body })
					.then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, json: j }; }); })
					.then(function (res) {
						if (res.ok && res.json && res.json.success && res.json.data && res.json.data.new_key) {
							input.value = res.json.data.new_key;
							input.type  = 'text'; // reveal so the merchant can verify / copy
							setMsg(res.json.data.message || 'Key rotated.', 'ok');
						} else {
							var msg = (res.json && res.json.data && res.json.data.message) || 'Rotation failed (HTTP ' + res.status + ').';
							setMsg(msg, 'warn');
						}
					})
					.catch(function (err) {
						setMsg('Rotation request failed: ' + (err && err.message ? err.message : err), 'warn');
					})
					.finally(function () { gen.disabled = false; });
			});

			cpy.addEventListener('click', function (e) {
				e.preventDefault();
				if (!input.value) {
					setMsg(<?php echo wp_json_encode( __( 'No key to copy. Generate one first.', 'agentmesh-woocommerce' ) ); ?>, 'warn');
					return;
				}
				var done = function () { setMsg(<?php echo wp_json_encode( __( 'Copied to clipboard.', 'agentmesh-woocommerce' ) ); ?>, 'ok'); };
				var fail = function () { setMsg(<?php echo wp_json_encode( __( 'Copy failed — select the Connector Key field and copy manually.', 'agentmesh-woocommerce' ) ); ?>, 'warn'); };
				if (navigator.clipboard && navigator.clipboard.writeText) {
					navigator.clipboard.writeText(input.value).then(done, fail);
				} else {
					var prev = input.type; input.type = 'text';
					input.select();
					try { document.execCommand('copy') ? done() : fail(); } catch (_) { fail(); }
					input.type = prev;
				}
			});
		})();
		</script>
		<?php
	}

	/**
	 * AJAX: rotate the connector key.
	 *
	 * Mints a fresh `amck_` + 32-byte hex key. If the store is already linked
	 * (current key + gateway URL + site_id all configured), posts the new key
	 * to {GATEWAY_URL}/v1/connector/rotate-key authenticated by the OLD key
	 * and only persists locally on a 200. Otherwise (initial setup) just
	 * persists locally and tells the merchant to paste it into the dashboard.
	 */
	public function ajax_rotate_key(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_send_json_error( [ 'message' => __( 'Insufficient permissions.', 'agentmesh-woocommerce' ) ], 403 );
		}
		check_ajax_referer( 'agentmesh_rotate_key', '_wpnonce' );

		$new_key     = 'amck_' . bin2hex( random_bytes( 32 ) );
		$current_key = (string) get_option( 'agentmesh_connector_key', '' );
		$gateway_url = rtrim( (string) get_option( 'agentmesh_gateway_url', 'https://api.synchronity.app' ), '/' );
		$site_id     = (string) get_option( 'agentmesh_site_id', '' );

		$linked = $current_key !== '' && $gateway_url !== '' && $site_id !== '';

		if ( ! $linked ) {
			update_option( 'agentmesh_connector_key', $new_key );
			wp_send_json_success( [
				'new_key' => $new_key,
				'pushed'  => false,
				'message' => __( 'New key generated locally. Paste it into the Synchronity dashboard to complete setup.', 'agentmesh-woocommerce' ),
			] );
		}

		$response = wp_remote_post( $gateway_url . '/v1/connector/rotate-key', [
			'headers' => [
				'Content-Type'              => 'application/json',
				'Accept'                    => 'application/json',
				'X-AgentMesh-Connector-Key' => $current_key,
				'X-Synchronity-Site-Id'     => $site_id,
			],
			'body'    => wp_json_encode( [ 'new_key' => $new_key ] ),
			'timeout' => 10,
		] );

		if ( is_wp_error( $response ) ) {
			wp_send_json_error( [
				'message' => sprintf(
					/* translators: %s: error message returned by the HTTP client */
					__( 'Could not reach the Synchronity gateway: %s. The current key is unchanged.', 'agentmesh-woocommerce' ),
					$response->get_error_message()
				),
			], 502 );
		}

		$code = (int) wp_remote_retrieve_response_code( $response );
		if ( $code !== 200 ) {
			wp_send_json_error( [
				'message' => sprintf(
					/* translators: %d: HTTP status code from the gateway */
					__( 'Gateway rejected the rotation (HTTP %d). The current key is unchanged.', 'agentmesh-woocommerce' ),
					$code
				),
				'gateway_body' => wp_remote_retrieve_body( $response ),
			], $code );
		}

		// Gateway accepted — persist locally so the two sides stay in sync.
		update_option( 'agentmesh_connector_key', $new_key );
		wp_send_json_success( [
			'new_key' => $new_key,
			'pushed'  => true,
			'message' => __( 'Key rotated and pushed to the Synchronity gateway.', 'agentmesh-woocommerce' ),
		] );
	}
}
