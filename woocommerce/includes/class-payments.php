<?php
/**
 * Inline (in-chat) payments — connector-owned orchestration.
 *
 * Exposes a generic PaymentProvider abstraction plus a Paystack implementation,
 * and registers the connector REST routes that the Synchronity Gateway proxies:
 *
 *   GET  /connector/payment/methods   (connector key)
 *   POST /connector/payment/initiate  (connector key)
 *   POST /connector/payment/submit-otp(connector key)
 *   GET  /connector/payment/status    (connector key)
 *   POST /webhooks/paystack           (Paystack HMAC-SHA512 signature)
 *
 * PCI: this layer NEVER collects/transmits/logs a card PAN, CVV or expiry. Card
 * users go through Paystack's hosted authorization_url. Mobile money pushes an
 * approval prompt / OTP. OTP is forwarded once to Paystack and never persisted.
 *
 * Amount + currency are ALWAYS derived from the WooCommerce order — never from
 * request input.
 */

defined( 'ABSPATH' ) || exit;

/**
 * Generic payment provider contract. Add new gateways (Flutterwave, Stripe, …)
 * by implementing this interface — no route changes needed.
 */
interface AgentMesh_Payment_Provider {

	/**
	 * Start a charge for an order on a given channel.
	 *
	 * @param WC_Order $order   The order (source of amount + currency).
	 * @param string   $channel 'mobile_money' | 'card'.
	 * @param array    $args    Channel inputs: ['phone' => ?, 'provider' => ?].
	 * @return array PaymentSession-shaped array (see AgentMesh_Normaliser::payment_session_to_amps()).
	 */
	public function initiate( WC_Order $order, string $channel, array $args ): array;

	/**
	 * Submit an OTP for an in-progress mobile money charge.
	 */
	public function submit_otp( WC_Order $order, string $reference, string $otp ): array;

	/**
	 * Verify a charge with the gateway (used on poll). Returns a normalised
	 * descriptor: ['status' => 'success'|'pending'|'failed'|'unknown', 'amount' => float, 'currency' => string, 'raw' => array].
	 */
	public function verify( string $reference ): array;

	/**
	 * Parse + authenticate an inbound webhook request.
	 * Returns ['valid' => bool, 'event' => string, 'reference' => string, 'amount' => float, 'currency' => string, 'raw' => array].
	 */
	public function parse_webhook( WP_REST_Request $request ): array;

	/**
	 * Enabled channels for this store/order, filtered by config + currency.
	 *
	 * @return array{methods: string[], currency: string, mobile_money_providers: string[]}
	 */
	public function get_methods( WC_Order $order ): array;
}

/**
 * Paystack implementation of {@see AgentMesh_Payment_Provider}.
 */
class AgentMesh_Paystack_Provider implements AgentMesh_Payment_Provider {

	const API_BASE = 'https://api.paystack.co';

	/** Mobile money providers supported in v1 (Ghana). */
	const MOBILE_MONEY_PROVIDERS = [ 'mtn', 'vod', 'tgo' ];

	// ─────────────────────────────────────────────────────────────────
	// Key reading (centralised)
	// ─────────────────────────────────────────────────────────────────

	/**
	 * Resolve Paystack keys. Prefers the Paystack-for-WooCommerce plugin options
	 * (`woocommerce_paystack_settings`), falls back to dedicated `agentmesh_paystack_*`
	 * options for stores without that plugin.
	 *
	 * @return array{secret_key:string, public_key:string, mode:string}
	 */
	public function get_keys(): array {
		$plugin = get_option( 'woocommerce_paystack_settings', [] );
		if ( is_array( $plugin ) && ( ! empty( $plugin['test_secret_key'] ) || ! empty( $plugin['live_secret_key'] ) ) ) {
			$testmode = isset( $plugin['testmode'] ) ? ( 'yes' === $plugin['testmode'] ) : true;
			$mode     = $testmode ? 'test' : 'live';
			return [
				'secret_key' => (string) ( $testmode ? ( $plugin['test_secret_key'] ?? '' ) : ( $plugin['live_secret_key'] ?? '' ) ),
				'public_key' => (string) ( $testmode ? ( $plugin['test_public_key'] ?? '' ) : ( $plugin['live_public_key'] ?? '' ) ),
				'mode'       => $mode,
			];
		}

		// Fallback: dedicated options.
		$mode     = (string) get_option( 'agentmesh_paystack_mode', 'test' );
		$testmode = ( 'live' !== $mode );
		return [
			'secret_key' => (string) get_option( $testmode ? 'agentmesh_paystack_test_secret_key' : 'agentmesh_paystack_live_secret_key', '' ),
			'public_key' => (string) get_option( $testmode ? 'agentmesh_paystack_test_public_key' : 'agentmesh_paystack_live_public_key', '' ),
			'mode'       => $testmode ? 'test' : 'live',
		];
	}

	public function get_secret_key(): string {
		return $this->get_keys()['secret_key'];
	}

	/**
	 * Interpret a WC-style checkbox option (defaults enabled). 'no'/false/'' → disabled,
	 * 'yes'/true/anything-else → enabled.
	 */
	private static function option_enabled( string $key ): bool {
		$val = get_option( $key, 'yes' );
		if ( is_bool( $val ) ) {
			return $val;
		}
		$val = strtolower( (string) $val );
		return ! in_array( $val, [ 'no', '0', '', 'false' ], true );
	}

	// ─────────────────────────────────────────────────────────────────
	// get_methods
	// ─────────────────────────────────────────────────────────────────

	public function get_methods( WC_Order $order ): array {
		$currency = $order->get_currency();

		$methods = [];
		// Mobile money is only meaningful for the supported local currency (GHS).
		// WC stores checkbox options as 'yes'/'no' strings; treat anything not 'no'/false as enabled.
		$mm_enabled   = self::option_enabled( 'agentmesh_payment_enable_mobile_money' );
		$card_enabled = self::option_enabled( 'agentmesh_payment_enable_card' );

		if ( $mm_enabled && 'GHS' === strtoupper( $currency ) ) {
			$methods[] = 'mobile_money';
		}
		if ( $card_enabled ) {
			$methods[] = 'card';
		}

		return [
			'methods'                => $methods,
			'currency'               => $currency,
			'mobile_money_providers' => in_array( 'mobile_money', $methods, true ) ? self::MOBILE_MONEY_PROVIDERS : [],
		];
	}

	// ─────────────────────────────────────────────────────────────────
	// initiate
	// ─────────────────────────────────────────────────────────────────

	public function initiate( WC_Order $order, string $channel, array $args ): array {
		$email     = $order->get_billing_email() ?: 'customer@example.com';
		$currency  = strtoupper( $order->get_currency() );
		// Amount in the smallest currency unit (kobo/pesewas) — ALWAYS from the order total.
		$amount    = (int) round( ( (float) $order->get_total() ) * 100 );
		$reference = $this->generate_reference( $order );

		if ( 'card' === $channel ) {
			$resp = $this->api_post( '/transaction/initialize', [
				'email'        => $email,
				'amount'       => $amount,
				'currency'     => $currency,
				'reference'    => $reference,
				// Browser return after payment. MUST be a GET landing page — NOT the
				// POST-only webhook. Passing it explicitly overrides whatever callback
				// URL is configured in the merchant's Paystack dashboard.
				'callback_url' => $this->return_url(),
			] );

			if ( is_wp_error( $resp ) ) {
				return $this->fail_session( $order, $reference, $channel, $resp->get_error_message() );
			}

			$data = $resp['data'] ?? [];
			$auth_url = $data['authorization_url'] ?? '';
			$ref      = $data['reference'] ?? $reference;
			if ( empty( $resp['status'] ) || empty( $auth_url ) ) {
				return $this->fail_session( $order, $ref, $channel, $resp['message'] ?? 'Could not initialise card payment.' );
			}

			$this->store_reference( $order, $ref, $channel, $data['id'] ?? null );

			return AgentMesh_Normaliser::payment_session_to_amps( $order, [
				'reference'      => $ref,
				'channel'        => $channel,
				'payment_status' => 'awaiting_user',
				'authorization_url' => $auth_url,
				'message'        => 'Tap the link to pay securely on Paystack.',
			] );
		}

		if ( 'mobile_money' === $channel ) {
			$phone    = preg_replace( '/[^0-9+]/', '', (string) ( $args['phone'] ?? '' ) );
			$provider = strtolower( sanitize_text_field( (string) ( $args['provider'] ?? '' ) ) );

			if ( empty( $phone ) ) {
				return $this->fail_session( $order, $reference, $channel, 'phone is required for mobile money.' );
			}
			if ( ! in_array( $provider, self::MOBILE_MONEY_PROVIDERS, true ) ) {
				return $this->fail_session( $order, $reference, $channel, 'provider must be one of: ' . implode( ', ', self::MOBILE_MONEY_PROVIDERS ) . '.' );
			}

			$resp = $this->api_post( '/charge', [
				'email'        => $email,
				'amount'       => $amount,
				'currency'     => $currency,
				'reference'    => $reference,
				'mobile_money' => [ 'phone' => $phone, 'provider' => $provider ],
			] );

			if ( is_wp_error( $resp ) ) {
				return $this->fail_session( $order, $reference, $channel, $resp->get_error_message() );
			}

			$data = $resp['data'] ?? [];
			$ref  = $data['reference'] ?? $reference;
			$this->store_reference( $order, $ref, $channel, $data['id'] ?? null );

			return $this->map_charge_response( $order, $ref, $channel, $provider, $phone, $data );
		}

		return $this->fail_session( $order, $reference, $channel, 'Unsupported channel.' );
	}

	// ─────────────────────────────────────────────────────────────────
	// submit_otp
	// ─────────────────────────────────────────────────────────────────

	public function submit_otp( WC_Order $order, string $reference, string $otp ): array {
		$channel  = $order->get_meta( '_agentmesh_payment_channel' ) ?: 'mobile_money';
		$provider = strtolower( (string) $order->get_meta( '_agentmesh_payment_provider' ) );
		$phone    = (string) $order->get_meta( '_agentmesh_payment_phone' );

		// OTP forwarded once to Paystack, never persisted.
		$resp = $this->api_post( '/charge/submit_otp', [
			'reference' => $reference,
			'otp'       => $otp,
		] );

		if ( is_wp_error( $resp ) ) {
			return $this->fail_session( $order, $reference, $channel, $resp->get_error_message() );
		}

		$data = $resp['data'] ?? [];
		return $this->map_charge_response( $order, $reference, $channel, $provider, $phone, $data );
	}

	// ─────────────────────────────────────────────────────────────────
	// verify
	// ─────────────────────────────────────────────────────────────────

	public function verify( string $reference ): array {
		$resp = $this->api_get( '/transaction/verify/' . rawurlencode( $reference ) );

		if ( is_wp_error( $resp ) ) {
			return [ 'status' => 'unknown', 'amount' => 0.0, 'currency' => '', 'raw' => [] ];
		}

		$data     = $resp['data'] ?? [];
		$ps_status = strtolower( (string) ( $data['status'] ?? 'unknown' ) );
		// Paystack verify returns amount in subunits.
		$amount   = isset( $data['amount'] ) ? ( (float) $data['amount'] ) / 100.0 : 0.0;
		$currency = strtoupper( (string) ( $data['currency'] ?? '' ) );

		$status = match ( $ps_status ) {
			'success'             => 'success',
			'failed', 'abandoned' => 'failed',
			'pending', 'ongoing', 'processing', 'send_otp', 'pay_offline' => 'pending',
			default               => 'unknown',
		};

		return [ 'status' => $status, 'amount' => $amount, 'currency' => $currency, 'raw' => $data ];
	}

	// ─────────────────────────────────────────────────────────────────
	// parse_webhook
	// ─────────────────────────────────────────────────────────────────

	public function parse_webhook( WP_REST_Request $request ): array {
		$raw       = $request->get_body();
		$signature = $request->get_header( 'x-paystack-signature' );
		$secret    = $this->get_secret_key();

		$valid = false;
		if ( ! empty( $secret ) && ! empty( $signature ) && '' !== (string) $raw ) {
			$computed = hash_hmac( 'sha512', (string) $raw, $secret );
			$valid    = hash_equals( $computed, (string) $signature );
		}

		$payload   = json_decode( (string) $raw, true );
		$payload   = is_array( $payload ) ? $payload : [];
		$event     = (string) ( $payload['event'] ?? '' );
		$data      = $payload['data'] ?? [];
		$reference = (string) ( $data['reference'] ?? '' );
		$amount    = isset( $data['amount'] ) ? ( (float) $data['amount'] ) / 100.0 : 0.0;
		$currency  = strtoupper( (string) ( $data['currency'] ?? '' ) );

		return [
			'valid'     => $valid,
			'event'     => $event,
			'reference' => $reference,
			'amount'    => $amount,
			'currency'  => $currency,
			'raw'       => $payload,
		];
	}

	// ─────────────────────────────────────────────────────────────────
	// Internal helpers
	// ─────────────────────────────────────────────────────────────────

	/**
	 * Map a Paystack /charge (or submit_otp) `data` block to a PaymentSession.
	 */
	private function map_charge_response( WC_Order $order, string $reference, string $channel, string $provider, string $phone, array $data ): array {
		$status = strtolower( (string) ( $data['status'] ?? '' ) );

		switch ( $status ) {
			case 'success':
				return AgentMesh_Normaliser::payment_session_to_amps( $order, [
					'reference'      => $reference,
					'channel'        => $channel,
					'payment_status' => 'processing',
					'message'        => 'Payment received. Finalising your order…',
				] );

			case 'send_otp':
				return AgentMesh_Normaliser::payment_session_to_amps( $order, [
					'reference'      => $reference,
					'channel'        => $channel,
					'payment_status' => 'awaiting_user',
					'action'         => 'submit_otp',
					'provider'       => $provider,
					'phone'          => $phone,
					'message'        => (string) ( $data['display_text'] ?? 'Enter the OTP sent to your phone.' ),
				] );

			case 'pay_offline':
			case 'pending':
			case 'ongoing':
			case 'processing':
				return AgentMesh_Normaliser::payment_session_to_amps( $order, [
					'reference'      => $reference,
					'channel'        => $channel,
					'payment_status' => 'awaiting_user',
					'action'         => 'approve_on_phone',
					'provider'       => $provider,
					'phone'          => $phone,
					'message'        => (string) ( $data['display_text'] ?? 'Approve the prompt on your phone to complete payment.' ),
				] );

			case 'failed':
				return $this->fail_session( $order, $reference, $channel, (string) ( $data['gateway_response'] ?? $data['message'] ?? 'Payment failed.' ) );

			default:
				return AgentMesh_Normaliser::payment_session_to_amps( $order, [
					'reference'      => $reference,
					'channel'        => $channel,
					'payment_status' => 'awaiting_user',
					'action'         => 'approve_on_phone',
					'provider'       => $provider,
					'phone'          => $phone,
					'message'        => 'Awaiting confirmation…',
				] );
		}
	}

	private function fail_session( WC_Order $order, string $reference, string $channel, string $message ): array {
		return AgentMesh_Normaliser::payment_session_to_amps( $order, [
			'reference'      => $reference,
			'channel'        => $channel,
			'payment_status' => 'failed',
			'message'        => $message,
		] );
	}

	/**
	 * Persist the Paystack reference / channel / txn id on the order.
	 * No card PAN/CVV/OTP is ever stored.
	 */
	private function store_reference( WC_Order $order, string $reference, string $channel, $txn_id = null ): void {
		$order->update_meta_data( '_agentmesh_payment_reference', $reference );
		$order->update_meta_data( '_agentmesh_payment_channel', $channel );
		if ( null !== $txn_id && '' !== (string) $txn_id ) {
			$order->update_meta_data( '_agentmesh_paystack_txn_id', (string) $txn_id );
		}
		$order->save();
	}

	private function generate_reference( WC_Order $order ): string {
		return 'amref_' . $order->get_id() . '_' . bin2hex( random_bytes( 8 ) );
	}

	/**
	 * Browser return (callback) URL for card payments. Paystack appends
	 * ?reference=…&trxref=… and redirects the customer here after payment.
	 * This is the public GET landing page — distinct from the POST webhook.
	 */
	private function return_url(): string {
		return rest_url( AGENTMESH_REST_NAMESPACE . '/connector/payment/return' );
	}

	/**
	 * POST JSON to the Paystack API. Returns the decoded body array or WP_Error.
	 */
	private function api_post( string $path, array $body ) {
		$secret = $this->get_secret_key();
		if ( empty( $secret ) ) {
			return new WP_Error( 'paystack_not_configured', 'Paystack secret key is not configured.' );
		}

		$response = wp_remote_post( self::API_BASE . $path, [
			'timeout' => 20,
			'headers' => [
				'Authorization' => 'Bearer ' . $secret,
				'Content-Type'  => 'application/json',
				'Accept'        => 'application/json',
			],
			'body'    => wp_json_encode( $body ),
		] );

		return $this->decode( $response );
	}

	/**
	 * GET from the Paystack API. Returns the decoded body array or WP_Error.
	 */
	private function api_get( string $path ) {
		$secret = $this->get_secret_key();
		if ( empty( $secret ) ) {
			return new WP_Error( 'paystack_not_configured', 'Paystack secret key is not configured.' );
		}

		$response = wp_remote_get( self::API_BASE . $path, [
			'timeout' => 20,
			'headers' => [
				'Authorization' => 'Bearer ' . $secret,
				'Accept'        => 'application/json',
			],
		] );

		return $this->decode( $response );
	}

	private function decode( $response ) {
		if ( is_wp_error( $response ) ) {
			return new WP_Error( 'paystack_http_error', 'Could not reach Paystack: ' . $response->get_error_message() );
		}

		$body    = wp_remote_retrieve_body( $response );
		$decoded = json_decode( (string) $body, true );
		if ( ! is_array( $decoded ) ) {
			return new WP_Error( 'paystack_bad_response', 'Unexpected response from Paystack.' );
		}

		return $decoded;
	}
}

/**
 * REST routes for inline payments + Paystack webhook + shared status-advance logic.
 */
class AgentMesh_Payments {

	private AgentMesh_Auth $auth;
	private AgentMesh_Payment_Provider $provider;

	public function __construct( ?AgentMesh_Payment_Provider $provider = null ) {
		$this->auth     = new AgentMesh_Auth();
		$this->provider = $provider ?: new AgentMesh_Paystack_Provider();
	}

	public function register_routes(): void {
		register_rest_route(
			AGENTMESH_REST_NAMESPACE,
			'/connector/payment/methods',
			[
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => [ $this, 'get_methods' ],
				'permission_callback' => [ $this->auth, 'verify_connector_key' ],
			]
		);

		register_rest_route(
			AGENTMESH_REST_NAMESPACE,
			'/connector/payment/initiate',
			[
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => [ $this, 'initiate' ],
				'permission_callback' => [ $this->auth, 'verify_connector_key' ],
			]
		);

		register_rest_route(
			AGENTMESH_REST_NAMESPACE,
			'/connector/payment/submit-otp',
			[
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => [ $this, 'submit_otp' ],
				'permission_callback' => [ $this->auth, 'verify_connector_key' ],
			]
		);

		register_rest_route(
			AGENTMESH_REST_NAMESPACE,
			'/connector/payment/status',
			[
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => [ $this, 'status' ],
				'permission_callback' => [ $this->auth, 'verify_connector_key' ],
			]
		);

		register_rest_route(
			AGENTMESH_REST_NAMESPACE,
			'/webhooks/paystack',
			[
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => [ $this, 'handle_paystack_webhook' ],
				'permission_callback' => '__return_true', // authenticity verified inside via HMAC
			]
		);

		// Public browser landing for card payments (Paystack callback_url, GET).
		// Verifies the transaction with Paystack, advances the order, then renders
		// a minimal "return to your chat" page. Authenticity comes from verifying
		// the reference against Paystack — no connector key (it is a browser hit).
		register_rest_route(
			AGENTMESH_REST_NAMESPACE,
			'/connector/payment/return',
			[
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => [ $this, 'handle_return' ],
				'permission_callback' => '__return_true',
			]
		);
	}

	// ─────────────────────────────────────────────────────────────────
	// GET /connector/payment/methods
	// ─────────────────────────────────────────────────────────────────

	public function get_methods( WP_REST_Request $request ): WP_REST_Response {
		[ $order, $err ] = $this->load_order( $request );
		if ( $err ) {
			return AgentMesh_Auth::echo_request_id( $request, $err );
		}

		$response = new WP_REST_Response( $this->provider->get_methods( $order ), 200 );
		return AgentMesh_Auth::echo_request_id( $request, $response );
	}

	// ─────────────────────────────────────────────────────────────────
	// POST /connector/payment/initiate
	// ─────────────────────────────────────────────────────────────────

	public function initiate( WP_REST_Request $request ): WP_REST_Response {
		[ $order, $err ] = $this->load_order( $request );
		if ( $err ) {
			return AgentMesh_Auth::echo_request_id( $request, $err );
		}

		// Amount is server-derived; only a pending order may be charged.
		if ( 'pending' !== $order->get_status() ) {
			$r = new WP_REST_Response(
				AgentMesh_Auth::error_response( 'INVALID_REQUEST', 'Order is not awaiting payment (status: ' . $order->get_status() . ').' ),
				409
			);
			return AgentMesh_Auth::echo_request_id( $request, $r );
		}

		$channel = sanitize_text_field( (string) $request->get_param( 'channel' ) );
		if ( ! in_array( $channel, [ 'mobile_money', 'card' ], true ) ) {
			$r = new WP_REST_Response(
				AgentMesh_Auth::error_response( 'INVALID_REQUEST', 'channel must be "mobile_money" or "card".' ),
				400
			);
			return AgentMesh_Auth::echo_request_id( $request, $r );
		}

		$phone    = sanitize_text_field( (string) ( $request->get_param( 'phone' ) ?: '' ) );
		$provider = sanitize_text_field( (string) ( $request->get_param( 'provider' ) ?: '' ) );

		// Remember mobile money context for the OTP step (no PAN/OTP stored).
		if ( 'mobile_money' === $channel ) {
			$order->update_meta_data( '_agentmesh_payment_phone', $phone );
			$order->update_meta_data( '_agentmesh_payment_provider', strtolower( $provider ) );
			$order->save();
		}

		$session = $this->provider->initiate( $order, $channel, [ 'phone' => $phone, 'provider' => $provider ] );

		$response = new WP_REST_Response( $session, 200 );
		return AgentMesh_Auth::echo_request_id( $request, $response );
	}

	// ─────────────────────────────────────────────────────────────────
	// POST /connector/payment/submit-otp
	// ─────────────────────────────────────────────────────────────────

	public function submit_otp( WP_REST_Request $request ): WP_REST_Response {
		[ $order, $err ] = $this->load_order( $request, true );
		if ( $err ) {
			return AgentMesh_Auth::echo_request_id( $request, $err );
		}

		$otp = sanitize_text_field( (string) ( $request->get_param( 'otp' ) ?: '' ) );
		if ( '' === $otp ) {
			$r = new WP_REST_Response( AgentMesh_Auth::error_response( 'INVALID_REQUEST', 'otp is required.' ), 400 );
			return AgentMesh_Auth::echo_request_id( $request, $r );
		}

		$reference = (string) $order->get_meta( '_agentmesh_payment_reference' );
		if ( '' === $reference ) {
			$reference = sanitize_text_field( (string) ( $request->get_param( 'reference' ) ?: '' ) );
		}
		if ( '' === $reference ) {
			$r = new WP_REST_Response( AgentMesh_Auth::error_response( 'INVALID_REQUEST', 'No payment reference found for this order.' ), 400 );
			return AgentMesh_Auth::echo_request_id( $request, $r );
		}

		$session = $this->provider->submit_otp( $order, $reference, $otp );

		$response = new WP_REST_Response( $session, 200 );
		return AgentMesh_Auth::echo_request_id( $request, $response );
	}

	// ─────────────────────────────────────────────────────────────────
	// GET /connector/payment/status  (verify-on-poll)
	// ─────────────────────────────────────────────────────────────────

	public function status( WP_REST_Request $request ): WP_REST_Response {
		[ $order, $err ] = $this->load_order( $request );
		if ( $err ) {
			return AgentMesh_Auth::echo_request_id( $request, $err );
		}

		$reference = (string) $order->get_meta( '_agentmesh_payment_reference' );
		$channel   = (string) ( $order->get_meta( '_agentmesh_payment_channel' ) ?: 'mobile_money' );

		// Already paid → reflect terminal status without re-verifying.
		if ( in_array( $order->get_status(), [ 'processing', 'completed' ], true ) ) {
			$session = AgentMesh_Normaliser::payment_session_to_amps( $order, [
				'reference'      => $reference,
				'channel'        => $channel,
				'payment_status' => 'paid',
				'message'        => 'Payment confirmed.',
			] );
			$response = new WP_REST_Response( $session, 200 );
			return AgentMesh_Auth::echo_request_id( $request, $response );
		}

		if ( 'failed' === $order->get_status() ) {
			$session = AgentMesh_Normaliser::payment_session_to_amps( $order, [
				'reference'      => $reference,
				'channel'        => $channel,
				'payment_status' => 'failed',
				'message'        => 'Payment failed.',
			] );
			$response = new WP_REST_Response( $session, 200 );
			return AgentMesh_Auth::echo_request_id( $request, $response );
		}

		if ( '' === $reference ) {
			$session = AgentMesh_Normaliser::payment_session_to_amps( $order, [
				'reference'      => '',
				'channel'        => $channel,
				'payment_status' => 'pending',
				'message'        => 'No payment initiated yet.',
			] );
			$response = new WP_REST_Response( $session, 200 );
			return AgentMesh_Auth::echo_request_id( $request, $response );
		}

		// Verify-on-poll: ask Paystack for the canonical status.
		$verify = $this->provider->verify( $reference );

		if ( 'success' === $verify['status'] ) {
			// Advance the order idempotently (webhook may not have landed).
			$this->advance_order_paid( $order, $reference, $verify['amount'], $verify['currency'] );
			$session = AgentMesh_Normaliser::payment_session_to_amps( $order, [
				'reference'      => $reference,
				'channel'        => $channel,
				'payment_status' => 'paid',
				'message'        => 'Payment confirmed.',
			] );
		} elseif ( 'failed' === $verify['status'] ) {
			$this->advance_order_failed( $order, $reference );
			$session = AgentMesh_Normaliser::payment_session_to_amps( $order, [
				'reference'      => $reference,
				'channel'        => $channel,
				'payment_status' => 'failed',
				'message'        => 'Payment failed.',
			] );
		} else {
			$session = AgentMesh_Normaliser::payment_session_to_amps( $order, [
				'reference'      => $reference,
				'channel'        => $channel,
				'payment_status' => 'awaiting_user',
				'message'        => 'Still awaiting payment confirmation.',
			] );
		}

		$response = new WP_REST_Response( $session, 200 );
		return AgentMesh_Auth::echo_request_id( $request, $response );
	}

	// ─────────────────────────────────────────────────────────────────
	// POST /webhooks/paystack
	// ─────────────────────────────────────────────────────────────────

	public function handle_paystack_webhook( WP_REST_Request $request ): WP_REST_Response {
		$parsed = $this->provider->parse_webhook( $request );

		if ( empty( $parsed['valid'] ) ) {
			$r = new WP_REST_Response(
				AgentMesh_Auth::error_response( 'FORBIDDEN', 'Invalid Paystack signature.' ),
				401
			);
			return AgentMesh_Auth::echo_request_id( $request, $r );
		}

		$reference = (string) $parsed['reference'];
		if ( '' === $reference ) {
			$r = new WP_REST_Response(
				AgentMesh_Auth::error_response( 'INVALID_REQUEST', 'Missing reference in webhook.' ),
				400
			);
			return AgentMesh_Auth::echo_request_id( $request, $r );
		}

		$order = $this->find_order_by_reference( $reference );
		if ( ! $order ) {
			// Not one of our charges (e.g. plugin's own flow) — acknowledge so Paystack stops retrying.
			$response = new WP_REST_Response( [ 'received' => true ], 200 );
			return AgentMesh_Auth::echo_request_id( $request, $response );
		}

		$event = (string) $parsed['event'];
		if ( 'charge.success' === $event ) {
			$this->advance_order_paid( $order, $reference, (float) $parsed['amount'], (string) $parsed['currency'] );
		} elseif ( 'charge.failed' === $event ) {
			$this->advance_order_failed( $order, $reference );
		}

		$response = new WP_REST_Response( [ 'received' => true ], 200 );
		return AgentMesh_Auth::echo_request_id( $request, $response );
	}

	// ─────────────────────────────────────────────────────────────────
	// GET /connector/payment/return  (card browser landing)
	// ─────────────────────────────────────────────────────────────────

	/**
	 * Browser landing after a card payment. Paystack redirects here with
	 * ?reference=…&trxref=…. Verifies, advances the order, and renders a
	 * minimal HTML page. Outputs HTML directly (not REST JSON) and exits.
	 */
	public function handle_return( WP_REST_Request $request ): void {
		$reference = sanitize_text_field(
			(string) ( $request->get_param( 'reference' ) ?: $request->get_param( 'trxref' ) ?: '' )
		);

		$result = $this->resolve_return( $reference );

		// On success, hand the buyer to WooCommerce's own order-received (thank-you)
		// page — the store's real confirmation — instead of our minimal landing.
		// Other states keep the landing page (there is no thank-you page to show yet).
		if ( 'paid' === $result ) {
			$order = $this->find_order_by_reference( $reference );
			if ( $order ) {
				wp_safe_redirect( $order->get_checkout_order_received_url() );
				exit;
			}
		}

		status_header( 200 );
		header( 'Content-Type: text/html; charset=utf-8' );
		echo $this->render_return_page( $result ); // phpcs:ignore WordPress.Security.EscapeOutput
		exit;
	}

	/**
	 * Verify the reference against Paystack and advance the order. Returns one
	 * of: 'paid' | 'failed' | 'pending' | 'unknown'. Testable (no output/exit).
	 */
	public function resolve_return( string $reference ): string {
		if ( '' === $reference ) {
			return 'unknown';
		}

		$order = $this->find_order_by_reference( $reference );
		if ( ! $order ) {
			return 'unknown';
		}

		// Already settled (webhook/poll beat the redirect).
		if ( $order->is_paid() || in_array( $order->get_status(), [ 'processing', 'completed' ], true ) ) {
			return 'paid';
		}
		if ( 'failed' === $order->get_status() ) {
			return 'failed';
		}

		$verify = $this->provider->verify( $reference );
		if ( 'success' === $verify['status'] ) {
			$this->advance_order_paid( $order, $reference, (float) $verify['amount'], (string) $verify['currency'] );
			return 'paid';
		}
		if ( 'failed' === $verify['status'] ) {
			$this->advance_order_failed( $order, $reference );
			return 'failed';
		}

		return 'pending';
	}

	/**
	 * Minimal self-contained HTML landing page for the card return.
	 */
	public function render_return_page( string $result ): string {
		[ $title, $body, $accent ] = match ( $result ) {
			'paid'    => [ 'Payment received', 'Your payment was successful. You can close this tab and return to your chat — your order is being processed.', '#16a34a' ],
			'failed'  => [ 'Payment not completed', 'We could not confirm your payment. Return to your chat to try again or choose another method.', '#dc2626' ],
			'pending' => [ 'Payment processing', 'Your payment is still being confirmed. Return to your chat — it will update there shortly.', '#d97706' ],
			default   => [ 'Payment status unavailable', 'We could not match this payment. Return to your chat for the latest status.', '#6b7280' ],
		};

		$title = esc_html( $title );
		$body  = esc_html( $body );

		return <<<HTML
<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{$title}</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;margin:0;
    display:flex;min-height:100vh;align-items:center;justify-content:center;background:#f8fafc;color:#0f172a}
  .card{max-width:420px;padding:40px 32px;text-align:center;background:#fff;border-radius:16px;
    box-shadow:0 10px 30px rgba(2,6,23,.08);margin:16px}
  .dot{width:56px;height:56px;border-radius:50%;background:{$accent};margin:0 auto 20px;
    display:flex;align-items:center;justify-content:center;color:#fff;font-size:28px;line-height:1}
  h1{font-size:20px;margin:0 0 10px}p{font-size:15px;line-height:1.5;color:#475569;margin:0}
</style></head>
<body><div class="card"><div class="dot">•</div><h1>{$title}</h1><p>{$body}</p></div></body></html>
HTML;
	}

	// ─────────────────────────────────────────────────────────────────
	// Shared status-advance + gateway-notify (idempotent)
	// ─────────────────────────────────────────────────────────────────

	/**
	 * Advance a pending order to paid. Idempotent: guards against double
	 * completion from webhook + verify-on-poll racing.
	 */
	public function advance_order_paid( WC_Order $order, string $reference, float $amount, string $currency ): void {
		// Idempotency guard: already paid → notify (best effort) and return.
		if ( $order->is_paid() || in_array( $order->get_status(), [ 'processing', 'completed' ], true ) ) {
			return;
		}

		$order->update_meta_data( '_agentmesh_payment_gateway', 'paystack' );
		$order->update_meta_data( '_agentmesh_transaction_id', $reference );
		$order->update_meta_data( '_agentmesh_payment_completed_at', current_time( 'c' ) );
		$order->delete_meta_data( '_agentmesh_payment_url' );

		// Amount/currency mismatch flagging (mirrors class-payment-webhook.php).
		$order_total = (float) $order->get_total();
		if ( $amount > 0 && abs( $order_total - $amount ) > 0.01 ) {
			$order->update_meta_data( '_agentmesh_payment_mismatch', true );
			$order->update_meta_data( '_agentmesh_payment_expected', $order_total );
			$order->update_meta_data( '_agentmesh_payment_received', $amount );
			$order->add_order_note(
				sprintf(
					'Paystack payment amount mismatch. Expected: %s %s, Received: %s %s. Flagged for review.',
					number_format( $order_total, 2 ),
					$order->get_currency(),
					number_format( $amount, 2 ),
					$currency ?: $order->get_currency()
				),
				false,
				true
			);
		}

		$order->payment_complete( $reference );
		$order->add_order_note(
			sprintf( 'Inline payment completed via Paystack. Reference: %s', esc_html( $reference ) ),
			false,
			true
		);
		$order->save();

		$this->notify_gateway( $order, 'payment_completed', $reference );
	}

	/**
	 * Mark a pending order as failed. Idempotent.
	 */
	public function advance_order_failed( WC_Order $order, string $reference ): void {
		if ( in_array( $order->get_status(), [ 'failed', 'processing', 'completed' ], true ) ) {
			return;
		}
		$order->update_meta_data( '_agentmesh_payment_failed_at', current_time( 'c' ) );
		$order->update_meta_data( '_agentmesh_transaction_id', $reference );
		$order->set_status( 'failed' );
		$order->add_order_note(
			sprintf( 'Inline payment failed via Paystack. Reference: %s', esc_html( $reference ) ),
			false,
			true
		);
		$order->save();

		$this->notify_gateway( $order, 'payment_failed', $reference );
	}

	/**
	 * Notify the Synchronity Gateway of a payment status change + invalidate cache.
	 * Mirrors AgentMesh_Payment_Webhook::notify_gateway (kept here to avoid coupling
	 * to that class's private API).
	 */
	private function notify_gateway( WC_Order $order, string $event, string $reference ): void {
		$gateway_url = get_option( 'agentmesh_gateway_url', '' );
		if ( empty( $gateway_url ) ) {
			return;
		}

		$site_id       = (string) get_option( 'agentmesh_site_id', '' );
		$connector_key = (string) get_option( 'agentmesh_connector_key', '' );
		$order_id      = $order->get_id();

		$payload = [
			'order_id'       => $order_id,
			'event'          => $event,
			'transaction_id' => $reference,
			'gateway'        => 'paystack',
			'amount'         => (float) $order->get_total(),
			'currency'       => $order->get_currency(),
			'agent_name'     => $order->get_meta( '_agentmesh_agent_name' ) ?: null,
			'human_sub'      => $order->get_meta( '_agentmesh_human_sub' ) ?: null,
			'timestamp'      => current_time( 'c' ),
		];

		$body      = wp_json_encode( $payload );
		$signature = hash_hmac( 'sha256', $body, $connector_key );
		$url       = trailingslashit( $gateway_url ) . 'v1/sites/' . $site_id . '/webhooks/payment';

		$args = [
			'method'  => 'POST',
			'timeout' => 15,
			'headers' => [
				'Content-Type'          => 'application/json',
				'X-AgentMesh-Site-Id'   => $site_id,
				'X-AgentMesh-Signature' => 'sha256=' . $signature,
			],
			'body'    => $body,
		];

		if ( function_exists( 'as_enqueue_async_action' ) ) {
			as_enqueue_async_action(
				'agentmesh_notify_gateway_payment',
				[ 'url' => $url, 'args' => $args, 'site_id' => $site_id, 'order_id' => $order_id, 'connector_key' => $connector_key, 'gateway_url' => $gateway_url ],
				'agentmesh'
			);
		} else {
			wp_remote_post( $url, $args );
			$this->invalidate_order_cache( $gateway_url, $site_id, $order_id, $connector_key );
		}
	}

	private function invalidate_order_cache( string $gateway_url, string $site_id, int $order_id, string $connector_key ): void {
		$url       = trailingslashit( $gateway_url ) . 'v1/sites/' . $site_id . '/orders/' . $order_id . '/invalidate-cache';
		$signature = hash_hmac( 'sha256', '', $connector_key );

		wp_remote_post( $url, [
			'method'  => 'POST',
			'timeout' => 10,
			'headers' => [
				'Content-Type'          => 'application/json',
				'X-AgentMesh-Site-Id'   => $site_id,
				'X-AgentMesh-Signature' => 'sha256=' . $signature,
			],
			'body'    => wp_json_encode( [] ),
		] );
	}

	// ─────────────────────────────────────────────────────────────────
	// Order loading
	// ─────────────────────────────────────────────────────────────────

	/**
	 * Load the order from order_id (or reference when $allow_reference).
	 * Returns [ WC_Order|null, WP_REST_Response|null ].
	 */
	private function load_order( WP_REST_Request $request, bool $allow_reference = false ): array {
		$order_id = (int) $request->get_param( 'order_id' );

		if ( $order_id <= 0 && $allow_reference ) {
			$reference = sanitize_text_field( (string) ( $request->get_param( 'reference' ) ?: '' ) );
			if ( '' !== $reference ) {
				$order = $this->find_order_by_reference( $reference );
				if ( $order ) {
					return [ $order, null ];
				}
			}
		}

		if ( $order_id <= 0 ) {
			return [ null, new WP_REST_Response( AgentMesh_Auth::error_response( 'INVALID_REQUEST', 'order_id is required.' ), 400 ) ];
		}

		$order = wc_get_order( $order_id );
		if ( ! $order ) {
			return [ null, new WP_REST_Response( AgentMesh_Auth::error_response( 'NOT_FOUND', 'Order not found.' ), 404 ) ];
		}

		return [ $order, null ];
	}

	/**
	 * Map a Paystack reference back to a WC order via stored meta.
	 */
	private function find_order_by_reference( string $reference ): ?WC_Order {
		$orders = wc_get_orders( [
			'limit'      => 1,
			'meta_key'   => '_agentmesh_payment_reference',
			'meta_value' => $reference,
			'return'     => 'objects',
		] );

		if ( is_array( $orders ) && ! empty( $orders ) ) {
			$order = $orders[0];
			return $order instanceof WC_Order ? $order : null;
		}

		return null;
	}
}
