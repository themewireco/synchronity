<?php
/**
 * Checkout endpoint — POST /connector/checkout
 * Converts a cart into a WooCommerce order using programmatic order creation.
 */

defined( 'ABSPATH' ) || exit;

/**
 * Thrown by build_order when a required add-on is missing, so execute_checkout can
 * map it to a 422 with the proper AMPS error code.
 */
class AgentMesh_Addon_Exception extends Exception {
	public string $error_code;
	public function __construct( string $error_code, string $message ) {
		parent::__construct( $message );
		$this->error_code = $error_code;
	}
}

class AgentMesh_Checkout {

	private AgentMesh_Auth $auth;

	public function __construct() {
		$this->auth = new AgentMesh_Auth();
	}

	public function register_routes(): void {
		register_rest_route(
			AGENTMESH_REST_NAMESPACE,
			'/connector/checkout',
			[
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => [ $this, 'execute_checkout' ],
				'permission_callback' => [ $this->auth, 'verify_connector_key' ],
			]
		);
	}

	public function execute_checkout( WP_REST_Request $request ): WP_REST_Response {
		// Check the merchant has enabled checkout execution
		if ( ! get_option( 'agentmesh_allow_checkout', true ) ) {
			$r = new WP_REST_Response(
				AgentMesh_Auth::error_response( 'FORBIDDEN', 'Checkout execution is disabled for this store.' ),
				403
			);
			return AgentMesh_Auth::echo_request_id( $request, $r );
		}

		$cart_id             = sanitize_text_field( $request->get_param( 'cart_id' ) );
		$shipping_address    = $request->get_param( 'shipping_address' );
		$billing_address     = $request->get_param( 'billing_address' ) ?: $shipping_address;
		$customer_email      = sanitize_email( $request->get_param( 'customer_email' ) ?: '' );
		$customer_name       = sanitize_text_field( $request->get_param( 'customer_name' ) ?: '' );
		$customer_phone      = sanitize_text_field( $request->get_param( 'customer_phone' ) ?: '' );
		$buyer_token         = sanitize_text_field( $request->get_param( 'buyer_delegation_token' ) ?: '' );
		$notes               = sanitize_textarea_field( $request->get_param( 'notes' ) ?: '' );
		$human_sub           = sanitize_text_field( $request->get_param( 'human_sub' ) ?: '' );
		$delegated           = (bool) $request->get_param( 'delegated' );
		$agent_name          = sanitize_text_field( $request->get_param( 'agent_name' ) ?: '' );

		// Validate required fields
		if ( empty( $cart_id ) ) {
			$r = new WP_REST_Response( AgentMesh_Auth::error_response( 'INVALID_REQUEST', 'cart_id is required.' ), 400 );
			return AgentMesh_Auth::echo_request_id( $request, $r );
		}

		if ( empty( $shipping_address ) || empty( $shipping_address['line1'] ) || empty( $shipping_address['city'] ) || empty( $shipping_address['country_code'] ) ) {
			$r = new WP_REST_Response( AgentMesh_Auth::error_response( 'INVALID_REQUEST', 'Valid shipping_address (line1, city, country_code) is required.' ), 400 );
			return AgentMesh_Auth::echo_request_id( $request, $r );
		}

		// Verify buyer delegation token if provided
		if ( ! empty( $buyer_token ) ) {
			$token_error = $this->verify_delegation_token( $buyer_token );
			if ( $token_error ) {
				$r = new WP_REST_Response( AgentMesh_Auth::error_response( 'INVALID_TOKEN', $token_error ), 401 );
				return AgentMesh_Auth::echo_request_id( $request, $r );
			}
		}

		// Load the cart
		$cart_data = get_transient( AgentMesh_Cart::TRANSIENT_PREFIX . $cart_id );
		if ( false === $cart_data ) {
			$r = new WP_REST_Response( AgentMesh_Auth::error_response( 'NOT_FOUND', 'Cart not found.' ), 404 );
			return AgentMesh_Auth::echo_request_id( $request, $r );
		}

		if ( empty( $cart_data['items'] ) ) {
			$r = new WP_REST_Response( AgentMesh_Auth::error_response( 'INVALID_REQUEST', 'Cart is empty.' ), 422 );
			return AgentMesh_Auth::echo_request_id( $request, $r );
		}

		// Create the WC order
		try {
			$order = $this->build_order( $cart_data, $shipping_address, $billing_address, $customer_email, $customer_name, $notes, $customer_phone );
		} catch ( AgentMesh_Addon_Exception $e ) {
			$r = new WP_REST_Response(
				AgentMesh_Auth::error_response( $e->error_code, $e->getMessage() ),
				422
			);
			return AgentMesh_Auth::echo_request_id( $request, $r );
		} catch ( Exception $e ) {
			$r = new WP_REST_Response(
				AgentMesh_Auth::error_response( 'CHECKOUT_FAILED', $e->getMessage() ),
				422
			);
			return AgentMesh_Auth::echo_request_id( $request, $r );
		}

		// Stamp agent identity and delegation context on the order
		if ( $agent_name ) {
			$order->update_meta_data( '_agentmesh_agent_name', $agent_name );
		}
		if ( $human_sub ) {
			$order->update_meta_data( '_agentmesh_human_sub', $human_sub );
		}
		if ( $delegated ) {
			$order->update_meta_data( '_agentmesh_delegated', true );
		}
		if ( $buyer_token ) {
			$order->update_meta_data( '_agentmesh_delegation_token', $buyer_token );
		}

		// Get checkout URL where customer completes payment
		$checkout_url = wc_get_checkout_url();
		$order_key    = $order->get_order_key();
		$pay_url      = wc_get_endpoint_url( 'order-pay', $order->get_id(), $checkout_url );
		$pay_url      = add_query_arg( 'key', $order_key, $pay_url );

		// Debug: Log the generated URLs
		error_log( 'Synchronity Checkout Debug: checkout_url=' . $checkout_url );
		error_log( 'Synchronity Checkout Debug: order_id=' . $order->get_id() );
		error_log( 'Synchronity Checkout Debug: pay_url=' . $pay_url );

		// Set order to pending payment (customer needs to complete payment on checkout page)
		// Save payment_url and agent info to metadata FIRST (before normalizer reads it)
		$order->set_status( 'pending' );
		$order->update_meta_data( '_agentmesh_payment_url', $pay_url );
		$order->add_order_note(
			sprintf(
				'Order placed by AI agent%s via Synchronity%s. Awaiting payment completion. Pay URL: %s',
				$agent_name ? ' <strong>' . esc_html( $agent_name ) . '</strong>' : '',
				$human_sub ? ' (human-approved, id: ' . esc_html( substr( $human_sub, 0, 8 ) ) . '…)' : '',
				esc_url( $pay_url )
			),
			false,
			true
		);
		$order->save();

		// Remove the cart transient
		delete_transient( AgentMesh_Cart::TRANSIENT_PREFIX . $cart_id );

		// Normalize order (will now include payment_url from metadata and set status to pending_payment)
		$site_id  = (string) get_option( 'agentmesh_site_id', '' );
		$order_data = AgentMesh_Normaliser::order_to_amps( $order, $site_id );

		$response = new WP_REST_Response( $order_data, 201 );
		return AgentMesh_Auth::echo_request_id( $request, $response );
	}

	// ─────────────────────────────────────────────────────────────────
	// Delegation token verification
	// ─────────────────────────────────────────────────────────────────

	/**
	 * Verify a buyer delegation token against the Synchronity Gateway.
	 * Returns null on success, error message string on failure.
	 */
	private function verify_delegation_token( string $token ): ?string {
		$gateway_url = get_option( 'agentmesh_gateway_url', '' );
		if ( empty( $gateway_url ) ) {
			// If gateway URL not configured, log and proceed (dev mode tolerance)
			return null;
		}

		$response = wp_remote_get(
			trailingslashit( $gateway_url ) . 'v1/auth/delegate/verify',
			[
				'timeout' => 10,
				'headers' => [
					'Authorization' => 'Bearer ' . $token,
					'Accept'        => 'application/json',
				],
			]
		);

		if ( is_wp_error( $response ) ) {
			return 'Could not contact Synchronity Gateway: ' . $response->get_error_message();
		}

		$status = wp_remote_retrieve_response_code( $response );
		if ( 200 !== (int) $status ) {
			return 'Delegation token verification failed (HTTP ' . $status . ').';
		}

		return null;
	}

	// ─────────────────────────────────────────────────────────────────
	// WC order builder
	// ─────────────────────────────────────────────────────────────────

	/**
	 * @throws Exception on order creation failure.
	 */
	private function build_order( array $cart_data, array $shipping_address, array $billing_address, string $email, string $customer_name, string $notes, string $customer_phone = '' ): WC_Order {
		$order = wc_create_order();
		if ( is_wp_error( $order ) ) {
			throw new Exception( $order->get_error_message() );
		}

		// Add line items
		foreach ( $cart_data['items'] as $item ) {
			$product_id = (int) $item['product_id'];
			$variant_id = isset( $item['variant_id'] ) ? (int) $item['variant_id'] : 0;
			$quantity   = (int) $item['quantity'];

			$product = wc_get_product( $variant_id ?: $product_id );
			if ( ! $product ) {
				throw new Exception( 'Product ' . $product_id . ' not found.' );
			}

			$selected_addons = ( isset( $item['addons'] ) && is_array( $item['addons'] ) ) ? $item['addons'] : [];

			// Defense in depth: re-check that every required add-on is present.
			if ( class_exists( 'AgentMesh_Addons' ) ) {
				$base_product = $variant_id ? wc_get_product( $product_id ) : $product;
				if ( $base_product ) {
					$addons_def = AgentMesh_Addons::extract_addons( $base_product );
					foreach ( $addons_def as $def ) {
						if ( ! empty( $def['required'] ) && ! $this->addon_present( $selected_addons, $def['addon_id'] ) ) {
							throw new AgentMesh_Addon_Exception(
								'ADDON_REQUIRED',
								sprintf( 'Add-on "%s" is required.', $def['addon_id'] )
							);
						}
					}
				}
			}

			$item_id = $order->add_product( $product, $quantity );

			if ( ! empty( $selected_addons ) ) {
				self::fold_addons_into_line( $order, $item_id, $product, $quantity, $selected_addons );
			}
		}

		// Billing address
		$wc_billing = AgentMesh_Normaliser::amps_address_to_wc( $billing_address );
		$name_parts  = $this->split_name( $customer_name );
		$wc_billing['first_name'] = $wc_billing['first_name'] ?: $name_parts[0];
		$wc_billing['last_name']  = $wc_billing['last_name'] ?: $name_parts[1];
		$wc_billing['email']      = $email ?: $wc_billing['email'];
		// Phone: prefer billing address phone, fall back to the shipping address
		// phone, then the top-level customer_phone captured at checkout.
		$wc_billing['phone']      = $wc_billing['phone'] ?: ( $shipping_address['phone'] ?? '' ) ?: $customer_phone;

		$order->set_address( $wc_billing, 'billing' );
		$order->set_address( AgentMesh_Normaliser::amps_address_to_wc( $shipping_address ), 'shipping' );

		if ( $notes ) {
			$order->set_customer_note( $notes );
		}

		$order->set_currency( $cart_data['currency'] );

		// Add shipping method if selected
		if ( ! empty( $cart_data['selected_shipping_option_id'] ) ) {
			$shipping_option_id = $cart_data['selected_shipping_option_id'];
			$selected_option = null;
			foreach ( $cart_data['shipping_options'] ?? [] as $option ) {
				if ( $option['option_id'] === $shipping_option_id ) {
					$selected_option = $option;
					break;
				}
			}

			if ( $selected_option ) {
				$shipping_item = new WC_Order_Item_Shipping();
				$shipping_item->set_method_title( $selected_option['title'] );
				$method_parts = explode( ':', $selected_option['option_id'] );
				$shipping_item->set_method_id( $method_parts[0] ?? $selected_option['option_id'] );
				$shipping_item->set_instance_id( $method_parts[1] ?? '' );
				$shipping_item->set_total( (float) $selected_option['amount']['amount'] );
				$order->add_item( $shipping_item );
			}
		}

		// Apply discounts
		foreach ( $cart_data['discounts'] ?? [] as $discount ) {
			$coupon = new WC_Coupon( $discount['code'] );
			if ( $coupon->get_id() ) {
				$order->apply_coupon( strtolower( $discount['code'] ) );
			}
		}

		$order->calculate_totals();

		$order->update_meta_data( '_agentmesh_cart_id', $cart_data['cart_id'] );

		return $order;
	}

	/**
	 * Fold selected add-ons into a line item: stamp display meta + the machine blob,
	 * and add the price modifiers into the line subtotal/total so the ORDER total
	 * (and therefore the charged amount) includes the surcharge.
	 *
	 * IMPORTANT: mutate the order's IN-MEMORY item instance (`get_item($id, false)`),
	 * NOT a fresh DB-loaded copy (`get_item($id)` defaults $load_from_db=true). A
	 * detached copy persists separately but is invisible to `calculate_totals()`,
	 * which sums the in-memory items — that mismatch undercharged orders (line
	 * subtotal showed the surcharge while the order total stayed at base price).
	 */
	private static function fold_addons_into_line( $order, $item_id, $product, int $quantity, array $selected_addons ): void {
		// $load_from_db = false → the in-memory instance calculate_totals() will sum.
		$line_item = $order->get_item( $item_id, false );
		if ( ! $line_item ) {
			return;
		}
		$addon_per_unit = 0.0;
		foreach ( $selected_addons as $sel ) {
			$display_value = is_array( $sel['value'] ?? null )
				? implode( ', ', array_map( 'strval', $sel['value'] ) )
				: (string) ( $sel['value'] ?? '' );
			$line_item->add_meta_data( (string) ( $sel['label'] ?? $sel['addon_id'] ), $display_value, true );
			if ( isset( $sel['price_modifier']['amount'] ) ) {
				$addon_per_unit += (float) $sel['price_modifier']['amount'];
			}
		}

		// Machine-readable blob for order_to_amps round-tripping (hidden in admin via
		// the woocommerce_hidden_order_itemmeta filter — see AgentMesh_Checkout boot).
		$line_item->add_meta_data( '_agentmesh_addons', wp_json_encode( $selected_addons ), true );

		if ( 0.0 !== $addon_per_unit ) {
			// Honor the merchant's add-on pricing mode (mirrors class-cart.php add_item).
			// 'absolute' (opt-in): the line price IS the sum of selected option prices —
			// the base is ignored. Default 'additive': base + the surcharge.
			$pricing_mode = (string) get_option( 'agentmesh_addon_pricing_mode', 'additive' );
			if ( 'absolute' === $pricing_mode && $addon_per_unit > 0 ) {
				$line_value = $addon_per_unit * $quantity;
			} else {
				$base_unit  = (float) $product->get_price();
				$line_value = ( $base_unit + $addon_per_unit ) * $quantity;
			}
			$line_item->set_subtotal( $line_value );
			$line_item->set_total( $line_value );
		}
		$line_item->save();
	}

	/** Whether a selected-add-ons list contains a non-empty entry for $addon_id. */
	private function addon_present( array $selected_addons, string $addon_id ): bool {
		foreach ( $selected_addons as $sel ) {
			if ( ( $sel['addon_id'] ?? '' ) === $addon_id ) {
				$value = $sel['value'] ?? '';
				if ( is_array( $value ) ) {
					return ! empty( $value );
				}
				return '' !== (string) $value;
			}
		}
		return false;
	}

	private function split_name( string $full_name ): array {
		$parts = explode( ' ', trim( $full_name ), 2 );
		return [ $parts[0] ?? '', $parts[1] ?? '' ];
	}
}
