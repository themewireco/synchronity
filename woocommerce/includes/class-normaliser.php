<?php
/**
 * AMPS Normaliser — transforms WooCommerce objects into AMPS-compliant arrays.
 *
 * All methods are static so they can be called without instantiation
 * (useful in tests and in other classes).
 */

defined( 'ABSPATH' ) || exit;

class AgentMesh_Normaliser {

	// ─────────────────────────────────────────────────────────────────
	// product_to_amps
	// ─────────────────────────────────────────────────────────────────

	public static function product_to_amps( WC_Product $product, string $site_id ): array {
		$currency = get_woocommerce_currency();

		$price_raw         = $product->get_price();
		$compare_at_raw    = $product->get_regular_price();

		$price_amount      = $price_raw !== '' ? number_format( (float) $price_raw, 2, '.', '' ) : '0.00';
		$compare_at_amount = ( $compare_at_raw !== '' && (float) $compare_at_raw > (float) $price_raw )
			? number_format( (float) $compare_at_raw, 2, '.', '' )
			: null;

		$image_url = null;
		$images    = [];

		$image_id = $product->get_image_id();
		if ( $image_id ) {
			$src       = wp_get_attachment_url( $image_id );
			$image_url = $src ?: null;
			if ( $src ) {
				$alt      = get_post_meta( $image_id, '_wp_attachment_image_alt', true ) ?: null;
				$images[] = array_filter( [ 'url' => $src, 'alt' => $alt ], fn( $v ) => null !== $v );
			}
		}

		foreach ( $product->get_gallery_image_ids() as $gallery_id ) {
			$src = wp_get_attachment_url( $gallery_id );
			if ( $src ) {
				$alt      = get_post_meta( $gallery_id, '_wp_attachment_image_alt', true ) ?: null;
				$images[] = array_filter( [ 'url' => $src, 'alt' => $alt ], fn( $v ) => null !== $v );
			}
		}

		$amps = [
			'product_id'       => (string) $product->get_id(),
			'site_id'          => $site_id,
			'title'            => $product->get_name(),
			'description'      => $product->get_description() ?: null,
			'price'            => [ 'amount' => $price_amount, 'currency' => $currency ],
			'compare_at_price' => $compare_at_amount
				? [ 'amount' => $compare_at_amount, 'currency' => $currency ]
				: null,
			'availability'     => self::map_stock_status( $product->get_stock_status() ),
			'stock_quantity'   => $product->get_manage_stock() ? (int) $product->get_stock_quantity() : null,
			'sku'              => $product->get_sku() ?: '',
			'categories'       => self::get_term_names( $product->get_category_ids(), 'product_cat' ),
			'tags'             => self::get_term_names( $product->get_tag_ids(), 'product_tag' ),
			'attributes'       => self::extract_attributes( $product ),
			'variants'         => self::extract_variants( $product, $site_id, $currency ),
			'image_url'        => $image_url,
			'images'           => $images,
			'url'              => $product->get_permalink() ?: null,
			'metadata'         => [
				'woocommerce.post_id'   => $product->get_id(),
				'woocommerce.type'      => $product->get_type(),
				'woocommerce.status'    => $product->get_status(),
			],
		];

		// ACF add-ons (additive — omitted when none / ACF inactive).
		if ( class_exists( 'AgentMesh_Addons' ) ) {
			$addons = AgentMesh_Addons::extract_addons( $product );
			if ( ! empty( $addons ) ) {
				$amps['addons'] = $addons;
			}
		}

		return $amps;
	}

	// ─────────────────────────────────────────────────────────────────
	// cart_to_amps  (for carts stored in our transient format)
	// ─────────────────────────────────────────────────────────────────

	public static function cart_to_amps( array $cart_data, string $cart_id, string $site_id ): array {
		// Cart data is already in AMPS shape — just ensure required fields are present.
		$currency = $cart_data['currency'] ?? get_woocommerce_currency();

		return [
			'cart_id'    => $cart_id,
			'site_id'    => $site_id,
			'items'      => $cart_data['items'] ?? [],
			'discounts'  => $cart_data['discounts'] ?? [],
			'subtotal'   => $cart_data['subtotal'] ?? [ 'amount' => '0.00', 'currency' => $currency ],
			'total'      => $cart_data['total']    ?? [ 'amount' => '0.00', 'currency' => $currency ],
			'currency'   => $currency,
			'expires_at' => $cart_data['expires_at'] ?? gmdate( 'Y-m-d\TH:i:s\Z', time() + 86400 ),
		];
	}

	// ─────────────────────────────────────────────────────────────────
	// order_to_amps
	// ─────────────────────────────────────────────────────────────────

	public static function order_to_amps( WC_Order $order, string $site_id ): array {
		$currency = $order->get_currency();

		$items = [];
		foreach ( $order->get_items() as $item_id => $item ) {
			/** @var WC_Order_Item_Product $item */
			$product    = $item->get_product();
			$qty        = $item->get_quantity();
			$line_total = (float) $item->get_total();
			$unit_price = $qty > 0 ? $line_total / $qty : 0.0;

			$amps_item = [
				'item_id'    => (string) $item_id,
				'product_id' => (string) $item->get_product_id(),
				'title'      => $item->get_name(),
				'quantity'   => $qty,
				'unit_price' => [ 'amount' => number_format( $unit_price, 2, '.', '' ), 'currency' => $currency ],
				'line_total' => [ 'amount' => number_format( $line_total, 2, '.', '' ), 'currency' => $currency ],
			];

			if ( $item->get_variation_id() ) {
				$amps_item['variant_id'] = (string) $item->get_variation_id();
			}

			// Selected ACF add-ons stamped on the order item at checkout.
			if ( class_exists( 'AgentMesh_Addons' ) ) {
				$selected_addons = AgentMesh_Addons::addons_from_order_item( $item );
				if ( ! empty( $selected_addons ) ) {
					$amps_item['addons'] = $selected_addons;
				}
			}

			$items[] = $amps_item;
		}

		$discounts = [];
		foreach ( $order->get_coupon_codes() as $code ) {
			$coupon_item  = null;
			foreach ( $order->get_items( 'coupon' ) as $coupon_line ) {
				if ( strtolower( $coupon_line->get_code() ) === strtolower( $code ) ) {
					$coupon_item = $coupon_line;
					break;
				}
			}
			$discount_amount = $coupon_item ? (float) $coupon_item->get_discount() : 0.0;
			$discounts[]     = [
				'code'   => strtoupper( $code ),
				'amount' => [ 'amount' => number_format( $discount_amount, 2, '.', '' ), 'currency' => $currency ],
			];
		}

		$shipping_address = null;
		$ship             = $order->get_address( 'shipping' );
		if ( ! empty( $ship['country'] ) ) {
			$shipping_address = [
				'line1'        => $ship['address_1'] ?? '',
				'line2'        => $ship['address_2'] ?: null,
				'city'         => $ship['city'] ?? '',
				'state'        => $ship['state'] ?: null,
				'postal_code'  => $ship['postcode'] ?: null,
				'country_code' => strtoupper( $ship['country'] ),
			];
			// Drop null fields to keep response clean
			$shipping_address = array_filter( $shipping_address, fn( $v ) => null !== $v );
		}

		$tracking_number = $order->get_meta( '_tracking_number' ) ?: $order->get_meta( '_shipment_tracking_number' ) ?: null;

		// Generate WooCommerce customer payment page URL for pending orders
		$payment_url = null;
		if ( 'pending' === $order->get_status() || 'on-hold' === $order->get_status() ) {
			$payment_url = $order->get_checkout_payment_url();
		}

		// Determine status: based on WooCommerce order status
		$status = self::map_order_status( $order->get_status() );

		$amps = [
			'order_id'       => (string) $order->get_id(),
			'site_id'        => $site_id,
			'status'         => $status,
			'customer_name'  => trim( $order->get_billing_first_name() . ' ' . $order->get_billing_last_name() ) ?: null,
			'customer_email' => $order->get_billing_email() ?: null,
			'items'          => $items,
			'discounts'  => $discounts,
			'subtotal'   => [ 'amount' => number_format( (float) $order->get_subtotal(), 2, '.', '' ), 'currency' => $currency ],
			'total'      => [ 'amount' => number_format( (float) $order->get_total(), 2, '.', '' ), 'currency' => $currency ],
			'currency'   => $currency,
			'created_at' => $order->get_date_created() ? $order->get_date_created()->format( 'Y-m-d\TH:i:s\Z' ) : null,
			'updated_at' => $order->get_date_modified() ? $order->get_date_modified()->format( 'Y-m-d\TH:i:s\Z' ) : null,
		];

		if ( $shipping_address ) {
			$amps['shipping_address'] = $shipping_address;
		}
		if ( $tracking_number ) {
			$amps['tracking_number'] = $tracking_number;
		}
		if ( $payment_url ) {
			$amps['payment_url'] = $payment_url;
		}

		$human_sub = $order->get_meta( '_agentmesh_human_sub' );
		$agent_name = $order->get_meta( '_agentmesh_agent_name' );
		if ( $agent_name ) {
			$amps['agent_name'] = $agent_name;
		}
		if ( $human_sub ) {
			$amps['human_sub'] = $human_sub;
			$amps['delegated'] = true;
		}

		return $amps;
	}

	// ─────────────────────────────────────────────────────────────────
	// payment_session_to_amps
	// ─────────────────────────────────────────────────────────────────

	/**
	 * Build an AMPS PaymentSession (spec §7) from an order + a flat set of
	 * payment fields. The channel-specific PaymentInstruction is derived from
	 * the supplied `action` / `authorization_url`.
	 *
	 * Accepted $fields keys:
	 *   reference, channel ('mobile_money'|'card'), payment_status
	 *   (pending|awaiting_user|processing|paid|failed), message,
	 *   action ('approve_on_phone'|'submit_otp'|'redirect'), provider, phone,
	 *   authorization_url.
	 *
	 * @return array{order_id:string, reference:string, channel:string, payment_status:string, instruction?:array, message?:string}
	 */
	public static function payment_session_to_amps( WC_Order $order, array $fields ): array {
		$channel = $fields['channel'] ?? 'mobile_money';

		$session = [
			'order_id'       => (string) $order->get_id(),
			'reference'      => (string) ( $fields['reference'] ?? '' ),
			'channel'        => $channel,
			'payment_status' => $fields['payment_status'] ?? 'pending',
		];

		$instruction = self::build_payment_instruction( $channel, $fields );
		if ( null !== $instruction ) {
			$session['instruction'] = $instruction;
		}

		if ( ! empty( $fields['message'] ) ) {
			$session['message'] = (string) $fields['message'];
		}

		return $session;
	}

	/**
	 * Derive the channel-specific PaymentInstruction (spec §7) or null when the
	 * session carries no actionable instruction (e.g. terminal paid/failed).
	 */
	private static function build_payment_instruction( string $channel, array $fields ): ?array {
		$reference = (string) ( $fields['reference'] ?? '' );

		if ( 'card' === $channel ) {
			$auth_url = (string) ( $fields['authorization_url'] ?? '' );
			if ( '' === $auth_url ) {
				return null;
			}
			return [
				'channel'           => 'card',
				'action'            => 'redirect',
				'authorization_url' => $auth_url,
				'reference'         => $reference,
			];
		}

		if ( 'mobile_money' === $channel ) {
			$action = $fields['action'] ?? null;
			if ( ! in_array( $action, [ 'approve_on_phone', 'submit_otp' ], true ) ) {
				return null;
			}
			return [
				'channel'      => 'mobile_money',
				'action'       => $action,
				'provider'     => (string) ( $fields['provider'] ?? '' ),
				'phone'        => (string) ( $fields['phone'] ?? '' ),
				'reference'    => $reference,
				'display_text' => (string) ( $fields['message'] ?? '' ),
			];
		}

		return null;
	}

	// ─────────────────────────────────────────────────────────────────
	// amps_address_to_wc
	// ─────────────────────────────────────────────────────────────────

	public static function amps_address_to_wc( array $amps_address ): array {
		return [
			'first_name' => '',
			'last_name'  => '',
			'company'    => '',
			'address_1'  => $amps_address['line1'] ?? '',
			'address_2'  => $amps_address['line2'] ?? '',
			'city'       => $amps_address['city'] ?? '',
			'state'      => $amps_address['state'] ?? '',
			'postcode'   => $amps_address['postal_code'] ?? '',
			'country'    => strtoupper( $amps_address['country_code'] ?? '' ),
			'email'      => '',
			'phone'      => '',
		];
	}

	// ─────────────────────────────────────────────────────────────────
	// Private helpers
	// ─────────────────────────────────────────────────────────────────

	public static function map_stock_status( string $wc_status ): string {
		return match ( $wc_status ) {
			'instock'     => 'in_stock',
			'outofstock'  => 'out_of_stock',
			'onbackorder' => 'backorder',
			default       => 'out_of_stock',
		};
	}

	public static function map_order_status( string $wc_status ): string {
		// WC statuses are stored without the "wc-" prefix when retrieved via get_status()
		return match ( $wc_status ) {
			'pending'    => 'pending',
			'processing' => 'processing',
			'completed'  => 'completed',
			'cancelled'  => 'cancelled',
			'refunded'   => 'refunded',
			'on-hold'    => 'pending',
			'failed'     => 'cancelled',
			default      => 'processing',
		};
	}

	private static function get_term_names( array $term_ids, string $taxonomy ): array {
		if ( empty( $term_ids ) ) return [];
		$terms = get_terms( [
			'taxonomy' => $taxonomy,
			'include'  => $term_ids,
			'fields'   => 'names',
		] );
		return is_wp_error( $terms ) ? [] : array_values( $terms );
	}

	private static function extract_attributes( WC_Product $product ): array {
		$attributes = [];
		foreach ( $product->get_attributes() as $key => $attribute ) {
			/** @var WC_Product_Attribute $attribute */
			if ( $attribute->is_taxonomy() ) {
				$terms = wc_get_product_terms( $product->get_id(), $attribute->get_name(), [ 'fields' => 'names' ] );
				foreach ( $terms as $term_name ) {
					$attributes[] = [
						'name'  => wc_attribute_label( $attribute->get_name(), $product ),
						'value' => $term_name,
					];
				}
			} else {
				$options = $attribute->get_options();
				foreach ( $options as $option ) {
					$attributes[] = [
						'name'  => $attribute->get_name(),
						'value' => $option,
					];
				}
			}
		}
		return $attributes;
	}

	private static function extract_variants( WC_Product $product, string $site_id, string $currency ): array {
		if ( ! $product->is_type( 'variable' ) ) {
			return [];
		}

		/** @var WC_Product_Variable $product */
		$variants = [];
		foreach ( $product->get_children() as $variation_id ) {
			$variation = wc_get_product( $variation_id );
			if ( ! $variation || ! $variation->is_type( 'variation' ) ) continue;

			$var_price         = $variation->get_price();
			$var_regular_price = $variation->get_regular_price();
			$var_image_id      = $variation->get_image_id();
			$var_image_url     = $var_image_id ? wp_get_attachment_url( $var_image_id ) : null;

			$compare_at = ( $var_regular_price !== '' && (float) $var_regular_price > (float) $var_price )
				? [ 'amount' => number_format( (float) $var_regular_price, 2, '.', '' ), 'currency' => $currency ]
				: null;

			$var_attributes = [];
			foreach ( $variation->get_variation_attributes() as $attr_name => $attr_value ) {
				$clean_name = str_replace( 'attribute_', '', $attr_name );
				$var_attributes[] = [
					'name'  => wc_attribute_label( $clean_name, $product ),
					'value' => $attr_value,
				];
			}

			$variant = [
				'variant_id'       => (string) $variation_id,
				'title'            => $variation->get_name(),
				'sku'              => $variation->get_sku() ?: null,
				'price'            => [ 'amount' => number_format( (float) $var_price, 2, '.', '' ), 'currency' => $currency ],
				'compare_at_price' => $compare_at,
				'availability'     => self::map_stock_status( $variation->get_stock_status() ),
				'stock_quantity'   => $variation->get_manage_stock() ? (int) $variation->get_stock_quantity() : null,
				'attributes'       => $var_attributes,
				'image_url'        => $var_image_url ?: null,
			];

			$variants[] = $variant;
		}

		return $variants;
	}
}
