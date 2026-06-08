<?php
/**
 * Cart endpoints:
 *   POST   /connector/cart
 *   GET    /connector/cart/{id}
 *   POST   /connector/cart/{id}/items
 *   DELETE /connector/cart/{id}/items/{item_id}
 *   POST   /connector/cart/{id}/coupon
 *   PUT    /connector/cart/{id}/shipping-address
 *   POST   /connector/cart/{id}/shipping-option
 */

defined( 'ABSPATH' ) || exit;

class AgentMesh_Cart {

	/** Transient TTL in seconds (24 hours). */
	const CART_TTL = 86400;

	/** Transient key prefix. */
	const TRANSIENT_PREFIX = 'agentmesh_cart_';

	private AgentMesh_Auth $auth;

	public function __construct() {
		$this->auth = new AgentMesh_Auth();
	}

	public function register_routes(): void {
		$ns = AGENTMESH_REST_NAMESPACE;

		register_rest_route( $ns, '/connector/cart', [
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => [ $this, 'create_cart' ],
			'permission_callback' => [ $this->auth, 'verify_connector_key' ],
		] );

		register_rest_route( $ns, '/connector/cart/(?P<cart_id>[^/]+)', [
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => [ $this, 'get_cart' ],
			'permission_callback' => [ $this->auth, 'verify_connector_key' ],
		] );

		register_rest_route( $ns, '/connector/cart/(?P<cart_id>[^/]+)/items', [
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => [ $this, 'add_item' ],
			'permission_callback' => [ $this->auth, 'verify_connector_key' ],
		] );

		register_rest_route( $ns, '/connector/cart/(?P<cart_id>[^/]+)/items/(?P<item_id>[^/]+)', [
			'methods'             => WP_REST_Server::DELETABLE,
			'callback'            => [ $this, 'remove_item' ],
			'permission_callback' => [ $this->auth, 'verify_connector_key' ],
		] );

		register_rest_route( $ns, '/connector/cart/(?P<cart_id>[^/]+)/coupon', [
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => [ $this, 'apply_coupon' ],
			'permission_callback' => [ $this->auth, 'verify_connector_key' ],
		] );

		register_rest_route( $ns, '/connector/cart/(?P<cart_id>[^/]+)/shipping-address', [
			'methods'             => WP_REST_Server::EDITABLE, // PUT/PATCH
			'callback'            => [ $this, 'set_shipping_address' ],
			'permission_callback' => [ $this->auth, 'verify_connector_key' ],
		] );

		register_rest_route( $ns, '/connector/cart/(?P<cart_id>[^/]+)/shipping-option', [
			'methods'             => WP_REST_Server::CREATABLE, // POST
			'callback'            => [ $this, 'select_shipping_option' ],
			'permission_callback' => [ $this->auth, 'verify_connector_key' ],
		] );
	}

	// ─────────────────────────────────────────────────────────────────
	// POST /connector/cart
	// ─────────────────────────────────────────────────────────────────

	public function create_cart( WP_REST_Request $request ): WP_REST_Response {
		if ( ! get_option( 'agentmesh_allow_cart', true ) ) {
			return $this->forbidden_response( $request, 'Cart management is disabled.' );
		}

		$currency = strtoupper( sanitize_text_field( $request->get_param( 'currency' ) ?: get_woocommerce_currency() ) );
		$cart_id  = $this->generate_cart_id();
		$site_id  = (string) get_option( 'agentmesh_site_id', '' );

		$cart_data = $this->empty_cart_data( $cart_id, $site_id, $currency );
		$this->save_cart( $cart_id, $cart_data );

		$response = new WP_REST_Response( $cart_data, 201 );
		return AgentMesh_Auth::echo_request_id( $request, $response );
	}

	// ─────────────────────────────────────────────────────────────────
	// GET /connector/cart/{id}
	// ─────────────────────────────────────────────────────────────────

	public function get_cart( WP_REST_Request $request ): WP_REST_Response {
		$cart_id   = sanitize_text_field( $request->get_param( 'cart_id' ) );
		$cart_data = $this->load_cart( $cart_id );

		if ( false === $cart_data ) {
			return $this->not_found_response( $request, 'Cart not found.' );
		}

		if ( $this->is_expired( $cart_data ) ) {
			$this->delete_cart( $cart_id );
			return $this->gone_response( $request );
		}

		$response = new WP_REST_Response( $cart_data, 200 );
		return AgentMesh_Auth::echo_request_id( $request, $response );
	}

	// ─────────────────────────────────────────────────────────────────
	// POST /connector/cart/{id}/items
	// ─────────────────────────────────────────────────────────────────

	public function add_item( WP_REST_Request $request ): WP_REST_Response {
		$cart_id = sanitize_text_field( $request->get_param( 'cart_id' ) );
		[ $cart_data, $err ] = $this->resolve_cart( $cart_id );
		if ( $err ) return AgentMesh_Auth::echo_request_id( $request, $err );

		$product_id = (int) $request->get_param( 'product_id' );
		$quantity   = max( 1, (int) $request->get_param( 'quantity' ) );
		$variant_id = $request->get_param( 'variant_id' ) ? (int) $request->get_param( 'variant_id' ) : null;

		$product = wc_get_product( $variant_id ?: $product_id );
		if ( ! $product ) {
			return $this->not_found_response( $request, 'Product not found.' );
		}

		$currency   = $cart_data['currency'];

		// ── ACF add-ons: validate the buyer's selection against the product's
		//    definitions and resolve the per-unit price modifier (server-side only).
		$selected_addons   = [];
		$addon_modifier     = 0.0;
		$base_product       = $variant_id ? wc_get_product( $product_id ) : $product;
		if ( class_exists( 'AgentMesh_Addons' ) && $base_product ) {
			$addons_def    = AgentMesh_Addons::extract_addons( $base_product );
			$requested     = $request->get_param( 'addons' );
			$requested     = is_array( $requested ) ? $requested : [];

			if ( ! empty( $addons_def ) || ! empty( $requested ) ) {
				$result = AgentMesh_Addons::validate_and_resolve_selection( $addons_def, $requested );
				if ( $result instanceof WP_Error ) {
					$status = (int) ( $result->data['status'] ?? 422 );
					$r = new WP_REST_Response(
						AgentMesh_Auth::error_response( $result->get_error_code(), $result->get_error_message() ),
						$status
					);
					return AgentMesh_Auth::echo_request_id( $request, $r );
				}
				$selected_addons = $result['selected'];
				$addon_modifier  = (float) $result['modifier_total'];
			}
		}

		$base_price = (float) ( $variant_id ? $product->get_price() : wc_get_product( $product_id )->get_price() );
		// Pricing mode (default 'additive' — existing behaviour unchanged). In 'absolute'
		// mode (opt-in, e.g. builder products whose base price is a placeholder) the line
		// price is the sum of the selected option prices; the base is ignored unless no
		// priced add-on was selected.
		$pricing_mode = (string) get_option( 'agentmesh_addon_pricing_mode', 'additive' );
		if ( 'absolute' === $pricing_mode && $addon_modifier > 0 ) {
			$unit_price = $addon_modifier;
		} else {
			$unit_price = $base_price + $addon_modifier;
		}
		$line_total = $unit_price * $quantity;

		$item = [
			'item_id'    => 'item_' . $this->generate_short_id(),
			'product_id' => (string) $product_id,
			'title'      => $product->get_name(),
			'quantity'   => $quantity,
			'unit_price' => [ 'amount' => number_format( $unit_price, 2, '.', '' ), 'currency' => $currency ],
			'line_total' => [ 'amount' => number_format( $line_total, 2, '.', '' ), 'currency' => $currency ],
		];
		if ( $variant_id ) {
			$item['variant_id'] = (string) $variant_id;
		}
		if ( ! empty( $selected_addons ) ) {
			$item['addons'] = $selected_addons;
		}

		// Merge with an existing line only when product, variant AND add-on selection
		// all match — distinct add-on selections are separate line items.
		$merged = false;
		foreach ( $cart_data['items'] as &$existing ) {
			if ( $this->same_line( $existing, $item ) ) {
				$existing['quantity']  += $quantity;
				$existing_unit          = (float) $existing['unit_price']['amount'];
				$new_total              = $existing_unit * $existing['quantity'];
				$existing['line_total'] = [ 'amount' => number_format( $new_total, 2, '.', '' ), 'currency' => $currency ];
				$merged                 = true;
				break;
			}
		}
		unset( $existing );

		if ( ! $merged ) {
			$cart_data['items'][] = $item;
		}

		$cart_data = $this->recalculate( $cart_data );
		$this->save_cart( $cart_id, $cart_data );

		$response = new WP_REST_Response( $cart_data, 200 );
		return AgentMesh_Auth::echo_request_id( $request, $response );
	}

	// ─────────────────────────────────────────────────────────────────
	// DELETE /connector/cart/{id}/items/{item_id}
	// ─────────────────────────────────────────────────────────────────

	public function remove_item( WP_REST_Request $request ): WP_REST_Response {
		$cart_id = sanitize_text_field( $request->get_param( 'cart_id' ) );
		$item_id = sanitize_text_field( $request->get_param( 'item_id' ) );

		[ $cart_data, $err ] = $this->resolve_cart( $cart_id );
		if ( $err ) return AgentMesh_Auth::echo_request_id( $request, $err );

		$found = false;
		$cart_data['items'] = array_values( array_filter(
			$cart_data['items'],
			function ( $item ) use ( $item_id, &$found ) {
				if ( $item['item_id'] === $item_id ) { $found = true; return false; }
				return true;
			}
		) );

		if ( ! $found ) {
			return $this->not_found_response( $request, 'Cart item not found.' );
		}

		$cart_data = $this->recalculate( $cart_data );
		$this->save_cart( $cart_id, $cart_data );

		$response = new WP_REST_Response( $cart_data, 200 );
		return AgentMesh_Auth::echo_request_id( $request, $response );
	}

	// ─────────────────────────────────────────────────────────────────
	// POST /connector/cart/{id}/coupon
	// ─────────────────────────────────────────────────────────────────

	public function apply_coupon( WP_REST_Request $request ): WP_REST_Response {
		$cart_id = sanitize_text_field( $request->get_param( 'cart_id' ) );
		$code    = sanitize_text_field( $request->get_param( 'code' ) );

		[ $cart_data, $err ] = $this->resolve_cart( $cart_id );
		if ( $err ) return AgentMesh_Auth::echo_request_id( $request, $err );

		if ( empty( $code ) ) {
			$response = new WP_REST_Response(
				AgentMesh_Auth::error_response( 'INVALID_REQUEST', 'Coupon code is required.' ),
				400
			);
			return AgentMesh_Auth::echo_request_id( $request, $response );
		}

		$coupon = new WC_Coupon( $code );
		if ( ! $coupon->get_id() ) {
			$response = new WP_REST_Response(
				AgentMesh_Auth::error_response( 'INVALID_COUPON', 'Coupon code is invalid or expired.' ),
				400
			);
			return AgentMesh_Auth::echo_request_id( $request, $response );
		}

		// Validate coupon dates
		if ( $coupon->get_date_expires() && $coupon->get_date_expires()->getTimestamp() < time() ) {
			$response = new WP_REST_Response(
				AgentMesh_Auth::error_response( 'COUPON_EXPIRED', 'This coupon has expired.' ),
				400
			);
			return AgentMesh_Auth::echo_request_id( $request, $response );
		}

		$subtotal       = $this->cart_subtotal_float( $cart_data );
		$discount_amount = 0.0;
		$currency        = $cart_data['currency'];

		$discount_type = $coupon->get_discount_type();
		if ( 'percent' === $discount_type ) {
			$discount_amount = $subtotal * ( (float) $coupon->get_amount() / 100 );
		} else {
			$discount_amount = min( (float) $coupon->get_amount(), $subtotal );
		}

		// De-duplicate coupon applications
		$cart_data['discounts'] = array_values( array_filter(
			$cart_data['discounts'] ?? [],
			fn( $d ) => strtolower( $d['code'] ) !== strtolower( $code )
		) );

		$cart_data['discounts'][] = [
			'code'          => strtoupper( $code ),
			'description'   => $coupon->get_description() ?: null,
			'type'          => 'percent' === $discount_type ? 'percentage' : 'fixed',
			'coupon_value'  => (float) $coupon->get_amount(),
			'amount_saved'  => [ 'amount' => number_format( $discount_amount, 2, '.', '' ), 'currency' => $currency ],
			'amount'        => [ 'amount' => number_format( $discount_amount, 2, '.', '' ), 'currency' => $currency ],
		];

		$cart_data = $this->recalculate( $cart_data );
		$this->save_cart( $cart_id, $cart_data );

		$response = new WP_REST_Response( $cart_data, 200 );
		return AgentMesh_Auth::echo_request_id( $request, $response );
	}

	// ─────────────────────────────────────────────────────────────────
	// PUT /connector/cart/{id}/shipping-address
	// ─────────────────────────────────────────────────────────────────

	public function set_shipping_address( WP_REST_Request $request ): WP_REST_Response {
		try {
			$cart_id = sanitize_text_field( $request->get_param( 'cart_id' ) );
			[ $cart_data, $err ] = $this->resolve_cart( $cart_id );
			if ( $err ) return AgentMesh_Auth::echo_request_id( $request, $err );

			$country = strtoupper( sanitize_text_field( (string) $request->get_param( 'country_code' ) ) );
			if ( '' === $country ) {
				$r = new WP_REST_Response( AgentMesh_Auth::error_response( 'BAD_REQUEST', 'country_code is required.' ), 400 );
				return AgentMesh_Auth::echo_request_id( $request, $r );
			}

			$destination = [
				'country'  => $country,
				'state'    => strtoupper( sanitize_text_field( (string) $request->get_param( 'state' ) ) ),
				'postcode' => sanitize_text_field( (string) $request->get_param( 'postal_code' ) ),
				'city'     => sanitize_text_field( (string) $request->get_param( 'city' ) ),
			];

			$cart_data['shipping_destination'] = [
				'country_code' => $country,
				'postal_code'  => $destination['postcode'] !== '' ? $destination['postcode'] : null,
				'state'        => $destination['state'] !== '' ? $destination['state'] : null,
				'city'         => $destination['city'] !== '' ? $destination['city'] : null,
			];
			$cart_data['shipping_options'] = $this->compute_shipping_options( $cart_data, $destination );

			// A new destination invalidates any prior selection.
			unset( $cart_data['selected_shipping_option_id'], $cart_data['shipping_total'] );
			$cart_data = $this->recalculate( $cart_data );
			$this->save_cart( $cart_id, $cart_data );

			$response = new WP_REST_Response( $cart_data, 200 );
			return AgentMesh_Auth::echo_request_id( $request, $response );
		} catch ( Throwable $e ) {
			$r = new WP_REST_Response( [
				'code'    => 'PHP_FATAL_ERROR',
				'message' => $e->getMessage(),
				'data'    => [
					'file'  => $e->getFile(),
					'line'  => $e->getLine(),
					'trace' => $e->getTraceAsString(),
				],
			], 500 );
			return AgentMesh_Auth::echo_request_id( $request, $r );
		}
	}

	// ─────────────────────────────────────────────────────────────────
	// POST /connector/cart/{id}/shipping-option
	// ─────────────────────────────────────────────────────────────────

	public function select_shipping_option( WP_REST_Request $request ): WP_REST_Response {
		$cart_id = sanitize_text_field( $request->get_param( 'cart_id' ) );
		[ $cart_data, $err ] = $this->resolve_cart( $cart_id );
		if ( $err ) return AgentMesh_Auth::echo_request_id( $request, $err );

		$option_id = sanitize_text_field( (string) $request->get_param( 'option_id' ) );
		if ( '' === $option_id ) {
			$r = new WP_REST_Response( AgentMesh_Auth::error_response( 'BAD_REQUEST', 'option_id is required.' ), 400 );
			return AgentMesh_Auth::echo_request_id( $request, $r );
		}

		[ $cart_data, $select_err ] = $this->apply_selected_shipping( $cart_data, $option_id );
		if ( $select_err ) {
			$r = new WP_REST_Response( AgentMesh_Auth::error_response( 'SHIPPING_OPTION_UNAVAILABLE', $select_err ), 409 );
			return AgentMesh_Auth::echo_request_id( $request, $r );
		}

		$this->save_cart( $cart_id, $cart_data );
		$response = new WP_REST_Response( $cart_data, 200 );
		return AgentMesh_Auth::echo_request_id( $request, $response );
	}

	// ─────────────────────────────────────────────────────────────────
	// Shipping helpers
	// ─────────────────────────────────────────────────────────────────

	/**
	 * Build a WooCommerce shipping package from the (transient) cart's items and
	 * ask WooCommerce for the available rates for the destination. Returns an
	 * array of AMPSShippingOption. Integration seam (needs the WC runtime).
	 */
	private function compute_shipping_options( array $cart_data, array $destination ): array {
		if ( ! function_exists( 'WC' ) ) {
			return [];
		}

		// Ensure shipping class and methods are loaded and initialized in REST API context
		if ( ! class_exists( 'WC_Shipping' ) ) {
			$wc_abspath = defined( 'WC_ABSPATH' ) ? WC_ABSPATH : WP_PLUGIN_DIR . '/woocommerce/';
			if ( file_exists( $wc_abspath . 'includes/class-wc-shipping.php' ) ) {
				include_once $wc_abspath . 'includes/class-wc-shipping.php';
			}
		}
		if ( ! isset( WC()->shipping ) || ! WC()->shipping instanceof WC_Shipping ) {
			do_action( 'woocommerce_shipping_init' );
			if ( ! isset( WC()->shipping ) || ! WC()->shipping instanceof WC_Shipping ) {
				WC()->shipping = new WC_Shipping();
			}
		}

		// Ensure session context exists so caching/retrieval in WC_Shipping works without fatal error
		if ( ! class_exists( 'WC_Session_Handler' ) ) {
			$wc_abspath = defined( 'WC_ABSPATH' ) ? WC_ABSPATH : WP_PLUGIN_DIR . '/woocommerce/';
			if ( file_exists( $wc_abspath . 'includes/class-wc-session-handler.php' ) ) {
				include_once $wc_abspath . 'includes/class-wc-session-handler.php';
			}
		}
		if ( ( ! isset( WC()->session ) || ! WC()->session instanceof WC_Session ) && class_exists( 'WC_Session_Handler' ) ) {
			WC()->session = new WC_Session_Handler();
			if ( method_exists( WC()->session, 'init' ) ) {
				WC()->session->init();
			}
		}

		// Ensure customer context exists so zone matching works correctly
		if ( ( ! isset( WC()->customer ) || ! WC()->customer instanceof WC_Customer ) && class_exists( 'WC_Customer' ) ) {
			WC()->customer = new WC_Customer();
		}

		// Ensure cart context exists for any plugins/hooks that reference WC()->cart during shipping calculation
		if ( ! class_exists( 'WC_Cart' ) ) {
			$wc_abspath = defined( 'WC_ABSPATH' ) ? WC_ABSPATH : WP_PLUGIN_DIR . '/woocommerce/';
			if ( file_exists( $wc_abspath . 'includes/class-wc-cart.php' ) ) {
				include_once $wc_abspath . 'includes/class-wc-cart.php';
			}
		}
		if ( ( ! isset( WC()->cart ) || ! WC()->cart instanceof WC_Cart ) && class_exists( 'WC_Cart' ) ) {
			WC()->cart = new WC_Cart();
		}

		$currency      = $cart_data['currency'];
		$contents      = [];
		$contents_cost = 0.0;

		foreach ( $cart_data['items'] as $item ) {
			$pid     = (int) ( $item['variant_id'] ?? $item['product_id'] );
			$product = function_exists( 'wc_get_product' ) ? wc_get_product( $pid ) : null;
			if ( ! $product ) continue;

			$line = (float) $item['line_total']['amount'];
			$contents_cost += $line;
			$contents[ 'am_' . $item['item_id'] ] = [
				'data'          => $product,
				'quantity'      => (int) $item['quantity'],
				'line_total'    => $line,
				'line_subtotal' => $line,
			];
		}

		$package = [
			'contents'        => $contents,
			'contents_cost'   => $contents_cost,
			'applied_coupons' => [],
			'user'            => [ 'ID' => 0 ],
			'destination'     => [
				'country'   => $destination['country'],
				'state'     => $destination['state'],
				'postcode'  => $destination['postcode'],
				'city'      => $destination['city'],
				'address'   => '',
				'address_2' => '',
			],
		];

		$calc  = WC()->shipping->calculate_shipping_for_package( $package );
		$rates = ( is_array( $calc ) && ! empty( $calc['rates'] ) ) ? $calc['rates'] : [];

		$options = [];
		foreach ( $rates as $rate_id => $rate ) {
			$options[] = $this->format_shipping_option(
				(string) $rate_id,
				(string) $rate->get_label(),
				(float) $rate->get_cost(),
				$currency
			);
		}
		return $options;
	}

	/** Pure: shape a single rate as an AMPSShippingOption. */
	private function format_shipping_option( string $option_id, string $title, float $cost, string $currency ): array {
		return [
			'option_id'          => $option_id,
			'title'              => $title,
			'description'        => null,
			'amount'             => [ 'amount' => number_format( $cost, 2, '.', '' ), 'currency' => $currency ],
			'estimated_delivery' => null,
		];
	}

	/**
	 * Pure: select an option from the cart's stored shipping_options and bind its
	 * cost as shipping_total. Returns [cart_data, null] or [cart_data, errorMessage].
	 */
	private function apply_selected_shipping( array $cart_data, string $option_id ): array {
		$match = null;
		foreach ( $cart_data['shipping_options'] ?? [] as $opt ) {
			if ( $opt['option_id'] === $option_id ) { $match = $opt; break; }
		}
		if ( null === $match ) {
			return [ $cart_data, 'shipping option no longer available; re-fetch rates' ];
		}

		$cart_data['selected_shipping_option_id'] = $option_id;
		$cart_data['shipping_total']              = $match['amount'];
		$cart_data = $this->recalculate( $cart_data );
		return [ $cart_data, null ];
	}

	// ─────────────────────────────────────────────────────────────────
	// Internal helpers
	// ─────────────────────────────────────────────────────────────────

	/**
	 * Line identity: same product + variant + identical add-on selection. Distinct
	 * add-on selections on the same product must NOT merge into one line.
	 */
	private function same_line( array $a, array $b ): bool {
		if ( ( $a['product_id'] ?? null ) !== ( $b['product_id'] ?? null ) ) {
			return false;
		}
		if ( ( $a['variant_id'] ?? null ) !== ( $b['variant_id'] ?? null ) ) {
			return false;
		}
		return $this->addons_fingerprint( $a['addons'] ?? [] ) === $this->addons_fingerprint( $b['addons'] ?? [] );
	}

	/** Order-independent fingerprint of a selected-add-ons list. */
	private function addons_fingerprint( array $addons ): string {
		$parts = [];
		foreach ( $addons as $a ) {
			$value   = $a['value'] ?? '';
			$value   = is_array( $value ) ? implode( '|', array_map( 'strval', $value ) ) : (string) $value;
			$parts[] = ( $a['addon_id'] ?? '' ) . '=' . $value;
		}
		sort( $parts );
		return implode( ';', $parts );
	}

	private function generate_cart_id(): string {
		return 'cart_' . bin2hex( random_bytes( 12 ) );
	}

	private function generate_short_id(): string {
		return bin2hex( random_bytes( 6 ) );
	}

	private function empty_cart_data( string $cart_id, string $site_id, string $currency ): array {
		$currency = strtoupper( $currency );
		return [
			'cart_id'    => $cart_id,
			'site_id'    => $site_id,
			'items'      => [],
			'discounts'  => [],
			'subtotal'   => [ 'amount' => '0.00', 'currency' => $currency ],
			'total'      => [ 'amount' => '0.00', 'currency' => $currency ],
			'currency'   => $currency,
			'expires_at' => gmdate( 'Y-m-d\TH:i:s\Z', time() + self::CART_TTL ),
		];
	}

	private function recalculate( array $cart_data ): array {
		$currency = $cart_data['currency'];
		$subtotal = 0.0;
		foreach ( $cart_data['items'] as $item ) {
			$subtotal += (float) $item['line_total']['amount'];
		}

		$discount_total = 0.0;
		foreach ( $cart_data['discounts'] ?? [] as $discount ) {
			$discount_total += (float) $discount['amount']['amount'];
		}

		$shipping_total = isset( $cart_data['shipping_total']['amount'] )
			? (float) $cart_data['shipping_total']['amount']
			: 0.0;

		$total = max( 0.0, $subtotal - $discount_total + $shipping_total );

		$cart_data['subtotal'] = [ 'amount' => number_format( $subtotal, 2, '.', '' ), 'currency' => $currency ];
		$cart_data['total']    = [ 'amount' => number_format( $total, 2, '.', '' ), 'currency' => $currency ];

		return $cart_data;
	}

	private function cart_subtotal_float( array $cart_data ): float {
		return (float) ( $cart_data['subtotal']['amount'] ?? '0.00' );
	}

	private function save_cart( string $cart_id, array $cart_data ): void {
		set_transient( self::TRANSIENT_PREFIX . $cart_id, $cart_data, self::CART_TTL );
	}

	private function load_cart( string $cart_id ): array|false {
		return get_transient( self::TRANSIENT_PREFIX . $cart_id );
	}

	private function delete_cart( string $cart_id ): void {
		delete_transient( self::TRANSIENT_PREFIX . $cart_id );
	}

	private function is_expired( array $cart_data ): bool {
		if ( empty( $cart_data['expires_at'] ) ) return false;
		return strtotime( $cart_data['expires_at'] ) < time();
	}

	/**
	 * Load and validate a cart, returning [cart_data, null] or [null, WP_REST_Response].
	 */
	private function resolve_cart( string $cart_id ): array {
		if ( ! get_option( 'agentmesh_allow_cart', true ) ) {
			return [ null, new WP_REST_Response(
				AgentMesh_Auth::error_response( 'FORBIDDEN', 'Cart management is disabled.' ),
				403
			) ];
		}

		$cart_data = $this->load_cart( $cart_id );
		if ( false === $cart_data ) {
			return [ null, new WP_REST_Response(
				AgentMesh_Auth::error_response( 'NOT_FOUND', 'Cart not found.' ),
				404
			) ];
		}

		if ( $this->is_expired( $cart_data ) ) {
			$this->delete_cart( $cart_id );
			return [ null, new WP_REST_Response(
				AgentMesh_Auth::error_response( 'CART_EXPIRED', 'Cart session has expired.' ),
				410
			) ];
		}

		return [ $cart_data, null ];
	}

	private function not_found_response( WP_REST_Request $request, string $message ): WP_REST_Response {
		$r = new WP_REST_Response( AgentMesh_Auth::error_response( 'NOT_FOUND', $message ), 404 );
		return AgentMesh_Auth::echo_request_id( $request, $r );
	}

	private function forbidden_response( WP_REST_Request $request, string $message ): WP_REST_Response {
		$r = new WP_REST_Response( AgentMesh_Auth::error_response( 'FORBIDDEN', $message ), 403 );
		return AgentMesh_Auth::echo_request_id( $request, $r );
	}

	private function gone_response( WP_REST_Request $request ): WP_REST_Response {
		$r = new WP_REST_Response( AgentMesh_Auth::error_response( 'CART_EXPIRED', 'Cart session has expired.' ), 410 );
		return AgentMesh_Auth::echo_request_id( $request, $r );
	}
}
