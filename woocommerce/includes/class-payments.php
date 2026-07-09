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

	/** Stable gateway id: 'paystack' | 'stripe'. */
	public function id(): string;

	/** Human label for the gateway picker. */
	public function label(): string;

	/** True when API keys are present (gateway can transact). */
	public function is_configured(): bool;

	/** True when the merchant has enabled this gateway AND it is configured. */
	public function is_enabled(): bool;
}

/**
 * Paystack implementation of {@see AgentMesh_Payment_Provider}.
 */
class AgentMesh_Paystack_Provider implements AgentMesh_Payment_Provider {

	const API_BASE = 'https://api.paystack.co';

	/** Mobile money providers supported in v1 (Ghana). */
	const MOBILE_MONEY_PROVIDERS = [ 'mtn', 'vod', 'tgo' ];

	/** Human-facing labels for provider picker / agent copy. */
	const MOBILE_MONEY_PROVIDER_LABELS = [
		'mtn' => 'MTN',
		'vod' => 'Vodafone / Telecel',
		'tgo' => 'AirtelTigo',
	];

	/** Synonyms accepted from agents or buyers (mapped to canonical codes). */
	const MOBILE_MONEY_PROVIDER_ALIASES = [
		'mtn'        => 'mtn',
		'vod'        => 'vod',
		'vodafone'   => 'vod',
		'telecel'    => 'vod',
		'tgo'        => 'tgo',
		'tigo'       => 'tgo',
		'airtel'     => 'tgo',
		'airteltigo' => 'tgo',
		'at'         => 'tgo',
	];

	// ─────────────────────────────────────────────────────────────────
	// Mobile-money input normalisation (Ghana)
	// ─────────────────────────────────────────────────────────────────

	/**
	 * Map buyer-facing provider names to Paystack codes (mtn|vod|tgo).
	 * Returns '' when the input is not recognised.
	 */
	public static function normalize_mobile_money_provider( string $provider ): string {
		$key = strtolower( trim( sanitize_text_field( $provider ) ) );
		return self::MOBILE_MONEY_PROVIDER_ALIASES[ $key ] ?? '';
	}

	/**
	 * Normalise a Ghana mobile-money MSISDN for Paystack.
	 * Converts +233 / 233… to leading-0 local form (e.g. 0551234567).
	 */
	public static function normalize_ghana_phone( string $phone ): string {
		$digits = preg_replace( '/\D/', '', $phone ) ?? '';
		if ( str_starts_with( $digits, '233' ) && strlen( $digits ) >= 12 ) {
			$digits = '0' . substr( $digits, 3 );
		}
		if ( 9 === strlen( $digits ) && ! str_starts_with( $digits, '0' ) ) {
			$digits = '0' . $digits;
		}
		return $digits;
	}

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

	public function id(): string { return 'paystack'; }

	public function label(): string { return 'Paystack'; }

	public function is_configured(): bool {
		return '' !== $this->get_secret_key();
	}

	public function is_enabled(): bool {
		// Paystack defaults enabled for backward compatibility with existing stores.
		return $this->is_configured() && self::option_enabled( 'agentmesh_payment_enable_paystack' );
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

		$labels = [];
		foreach ( self::MOBILE_MONEY_PROVIDERS as $code ) {
			$labels[ $code ] = self::MOBILE_MONEY_PROVIDER_LABELS[ $code ] ?? $code;
		}

		return [
			'methods'                       => $methods,
			'currency'                      => $currency,
			'mobile_money_providers'        => in_array( 'mobile_money', $methods, true ) ? self::MOBILE_MONEY_PROVIDERS : [],
			'mobile_money_provider_labels'  => in_array( 'mobile_money', $methods, true ) ? $labels : [],
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
			$phone    = self::normalize_ghana_phone( (string) ( $args['phone'] ?? '' ) );
			$provider = self::normalize_mobile_money_provider( (string) ( $args['provider'] ?? '' ) );

			if ( empty( $phone ) ) {
				return $this->fail_session( $order, $reference, $channel, 'phone is required for mobile money.' );
			}
			if ( 'GHS' === $currency && ( 10 !== strlen( $phone ) || '0' !== $phone[0] ) ) {
				return $this->fail_session( $order, $reference, $channel, 'Phone must be a 10-digit Ghana mobile number (e.g. 0551234567 or +233551234567).' );
			}
			if ( ! in_array( $provider, self::MOBILE_MONEY_PROVIDERS, true ) ) {
				return $this->fail_session(
					$order,
					$reference,
					$channel,
					'provider must be one of: ' . implode( ', ', self::MOBILE_MONEY_PROVIDERS )
					. ' (aliases: telecel/vodafone → vod, airteltigo/tigo → tgo).'
				);
			}

			$resp = $this->api_post( '/charge', [
				'email'        => $email,
				'amount'       => $amount,
				'currency'     => $currency,
				'reference'    => $reference,
				'mobile_money' => [ 'phone' => $phone, 'provider' => $provider ],
			] );

			$this->log_paystack_response( 'charge', $reference, $resp, [
				'order_id' => $order->get_id(),
				'provider' => $provider,
				'phone'    => $phone,
			] );

			if ( is_wp_error( $resp ) ) {
				return $this->fail_session( $order, $reference, $channel, $resp->get_error_message() );
			}

			$data = $resp['data'] ?? [];
			$ref  = $data['reference'] ?? $reference;
			$this->store_reference( $order, $ref, $channel, $data['id'] ?? null );
			$order->update_meta_data( '_agentmesh_payment_phone', $phone );
			$order->update_meta_data( '_agentmesh_payment_provider', $provider );
			$order->save();

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

		$this->log_paystack_response( 'submit_otp', $reference, $resp, [
			'order_id' => $order->get_id(),
			'provider' => $provider,
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
			'failed'              => 'failed',
			// 'abandoned' = initialised but not completed — i.e. the buyer is still
			// in the awaiting-user window (entering the OTP, or on the card redirect
			// page). It is NOT terminal; treating it as failed bricks a payment that
			// is still in progress. A genuine decline returns Paystack 'failed'.
			'abandoned', 'pending', 'ongoing', 'processing', 'send_otp', 'pay_offline' => 'pending',
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

	/**
	 * Support logging for Paystack charge flows. Never logs OTPs or card data.
	 *
	 * @param string       $operation charge|submit_otp
	 * @param string       $reference Paystack reference
	 * @param array|WP_Error $resp    Decoded Paystack body or transport error
	 * @param array<string, mixed> $context Safe contextual fields (order_id, provider, phone)
	 */
	private function log_paystack_response( string $operation, string $reference, $resp, array $context = [] ): void {
		$logger = wc_get_logger();
		if ( is_wp_error( $resp ) ) {
			$logger->info(
				sprintf(
					'[AgentMesh Paystack] %s ref=%s %s',
					$operation,
					$reference,
					wp_json_encode( array_merge( $context, [ 'error' => $resp->get_error_message() ] ) )
				),
				[ 'source' => 'synchronity-for-woocommerce' ]
			);
			return;
		}

		$data = is_array( $resp ) ? ( $resp['data'] ?? [] ) : [];
		$safe = [
			'paystack_status'    => $data['status'] ?? null,
			'gateway_response'   => $data['gateway_response'] ?? null,
			'display_text'       => $data['display_text'] ?? null,
			'paystack_message'   => is_array( $resp ) ? ( $resp['message'] ?? null ) : null,
		];

		$logger->info(
			sprintf(
				'[AgentMesh Paystack] %s ref=%s %s',
				$operation,
				$reference,
				wp_json_encode( array_merge( $context, $safe ) )
			),
			[ 'source' => 'synchronity-for-woocommerce' ]
		);
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
 * Stripe implementation of {@see AgentMesh_Payment_Provider}.
 *
 * Card only, via Hosted Checkout Sessions (redirect) — the same UX as Paystack
 * card: the buyer taps a link, pays on Stripe, returns. No mobile money / OTP.
 *
 * PCI: never collects/transmits/logs a card PAN/CVV/expiry; Stripe hosts the form.
 * Amount + currency are ALWAYS derived from the WooCommerce order.
 */
class AgentMesh_Stripe_Provider implements AgentMesh_Payment_Provider {

	const API_BASE = 'https://api.stripe.com';

	public function id(): string { return 'stripe'; }
	public function label(): string { return 'Stripe'; }

	/**
	 * Resolve Stripe keys. Prefers the official Stripe-for-WooCommerce options
	 * (`woocommerce_stripe_settings`); falls back to dedicated `agentmesh_stripe_*`.
	 *
	 * @return array{secret_key:string, publishable_key:string, mode:string, webhook_secret:string}
	 */
	public function get_keys(): array {
		$plugin = get_option( 'woocommerce_stripe_settings', [] );
		if ( is_array( $plugin ) && ( ! empty( $plugin['test_secret_key'] ) || ! empty( $plugin['secret_key'] ) ) ) {
			$testmode = isset( $plugin['testmode'] ) ? ( 'yes' === $plugin['testmode'] ) : true;
			return [
				'secret_key'      => (string) ( $testmode ? ( $plugin['test_secret_key'] ?? '' ) : ( $plugin['secret_key'] ?? '' ) ),
				'publishable_key' => (string) ( $testmode ? ( $plugin['test_publishable_key'] ?? '' ) : ( $plugin['publishable_key'] ?? '' ) ),
				'mode'            => $testmode ? 'test' : 'live',
				'webhook_secret'  => (string) get_option( 'agentmesh_stripe_webhook_secret', '' ),
			];
		}

		$mode     = (string) get_option( 'agentmesh_stripe_mode', 'test' );
		$testmode = ( 'live' !== $mode );
		return [
			'secret_key'      => (string) get_option( $testmode ? 'agentmesh_stripe_test_secret_key' : 'agentmesh_stripe_live_secret_key', '' ),
			'publishable_key' => (string) get_option( $testmode ? 'agentmesh_stripe_test_publishable_key' : 'agentmesh_stripe_live_publishable_key', '' ),
			'mode'            => $testmode ? 'test' : 'live',
			'webhook_secret'  => (string) get_option( 'agentmesh_stripe_webhook_secret', '' ),
		];
	}

	private function get_secret_key(): string { return $this->get_keys()['secret_key']; }

	public function is_configured(): bool { return '' !== $this->get_secret_key(); }

	public function is_enabled(): bool {
		// Stripe defaults DISABLED — opt-in via the settings toggle.
		$toggle = get_option( 'agentmesh_payment_enable_stripe', 'no' );
		$on     = ! in_array( strtolower( (string) $toggle ), [ 'no', '0', '', 'false' ], true );
		return $this->is_configured() && $on;
	}

	public function get_methods( WC_Order $order ): array {
		return [
			'methods'                => [ 'card' ],
			'currency'               => $order->get_currency(),
			'mobile_money_providers' => [],
		];
	}

	public function initiate( WC_Order $order, string $channel, array $args ): array {
		if ( 'card' !== $channel ) {
			return $this->fail_session( $order, '', $channel, 'Stripe supports card payments only.' );
		}

		$currency  = strtolower( $order->get_currency() );
		$amount    = (int) round( ( (float) $order->get_total() ) * 100 ); // subunits, from the order

		$body = [
			'mode'                                  => 'payment',
			'success_url'                           => $this->return_url() . '?gateway=stripe&session_id={CHECKOUT_SESSION_ID}',
			'cancel_url'                            => $this->return_url() . '?gateway=stripe&cancel=1',
			'client_reference_id'                   => (string) $order->get_id(),
			'line_items[0][quantity]'               => 1,
			'line_items[0][price_data][currency]'   => $currency,
			'line_items[0][price_data][unit_amount]' => $amount,
			'line_items[0][price_data][product_data][name]' => 'Order #' . $order->get_id(),
		];
		$email = $order->get_billing_email();
		if ( '' !== (string) $email ) {
			$body['customer_email'] = (string) $email;
		}

		$resp = $this->api_post( '/v1/checkout/sessions', $body );

		if ( is_wp_error( $resp ) ) {
			return $this->fail_session( $order, '', $channel, $resp->get_error_message() );
		}

		$session_id = (string) ( $resp['id'] ?? '' );
		$url        = (string) ( $resp['url'] ?? '' );
		if ( '' === $session_id || '' === $url ) {
			return $this->fail_session( $order, $session_id, $channel, 'Could not initialise Stripe checkout.' );
		}

		$order->update_meta_data( '_agentmesh_payment_reference', $session_id );
		$order->update_meta_data( '_agentmesh_payment_channel', $channel );
		$order->update_meta_data( '_agentmesh_payment_gateway', 'stripe' );
		$order->save();

		return AgentMesh_Normaliser::payment_session_to_amps( $order, [
			'reference'         => $session_id,
			'channel'           => $channel,
			'payment_status'    => 'awaiting_user',
			'authorization_url' => $url,
			'message'           => 'Tap the link to pay securely on Stripe.',
		] );
	}

	public function submit_otp( WC_Order $order, string $reference, string $otp ): array {
		return $this->fail_session( $order, $reference, 'card', 'Stripe payments do not use OTP.' );
	}

	public function verify( string $reference ): array {
		$resp = $this->api_get( '/v1/checkout/sessions/' . rawurlencode( $reference ) );
		if ( is_wp_error( $resp ) ) {
			return [ 'status' => 'unknown', 'amount' => 0.0, 'currency' => '', 'raw' => [] ];
		}

		$pay_status = strtolower( (string) ( $resp['payment_status'] ?? '' ) );
		$status_str = strtolower( (string) ( $resp['status'] ?? '' ) );
		$amount     = isset( $resp['amount_total'] ) ? ( (float) $resp['amount_total'] ) / 100.0 : 0.0;
		$currency   = strtoupper( (string) ( $resp['currency'] ?? '' ) );

		if ( 'paid' === $pay_status || 'complete' === $status_str ) {
			$status = 'success';
		} elseif ( 'expired' === $status_str ) {
			$status = 'failed';
		} else {
			$status = 'pending';
		}

		return [ 'status' => $status, 'amount' => $amount, 'currency' => $currency, 'raw' => $resp ];
	}

	public function parse_webhook( WP_REST_Request $request ): array {
		$raw    = (string) $request->get_body();
		$sig    = (string) $request->get_header( 'stripe-signature' );
		$secret = $this->get_keys()['webhook_secret'];

		$valid = false;
		if ( '' !== $secret && '' !== $sig && '' !== $raw ) {
			$t = '';
			$v1 = '';
			foreach ( explode( ',', $sig ) as $part ) {
				$kv = explode( '=', trim( $part ), 2 );
				if ( 2 !== count( $kv ) ) { continue; }
				if ( 't' === $kv[0] ) { $t = $kv[1]; }
				if ( 'v1' === $kv[0] ) { $v1 = $kv[1]; }
			}
			if ( '' !== $t && '' !== $v1 ) {
				$computed = hash_hmac( 'sha256', $t . '.' . $raw, $secret );
				$valid    = hash_equals( $computed, $v1 );
			}
		}

		$payload   = json_decode( $raw, true );
		$payload   = is_array( $payload ) ? $payload : [];
		$event     = (string) ( $payload['type'] ?? '' );
		$obj       = $payload['data']['object'] ?? [];
		$reference = (string) ( $obj['id'] ?? '' ); // checkout.session id
		$amount    = isset( $obj['amount_total'] ) ? ( (float) $obj['amount_total'] ) / 100.0 : 0.0;
		$currency  = strtoupper( (string) ( $obj['currency'] ?? '' ) );

		return [
			'valid'     => $valid,
			'event'     => $event,
			'reference' => $reference,
			'amount'    => $amount,
			'currency'  => $currency,
			'raw'       => $payload,
		];
	}

	private function return_url(): string {
		return rest_url( AGENTMESH_REST_NAMESPACE . '/connector/payment/return' );
	}

	private function fail_session( WC_Order $order, string $reference, string $channel, string $message ): array {
		return AgentMesh_Normaliser::payment_session_to_amps( $order, [
			'reference'      => $reference,
			'channel'        => $channel,
			'payment_status' => 'failed',
			'message'        => $message,
		] );
	}

	/** POST form-encoded to Stripe. Returns decoded body array or WP_Error. */
	private function api_post( string $path, array $body ) {
		$secret = $this->get_secret_key();
		if ( '' === $secret ) {
			return new WP_Error( 'stripe_not_configured', 'Stripe secret key is not configured.' );
		}
		$response = wp_remote_post( self::API_BASE . $path, [
			'timeout' => 20,
			'headers' => [
				'Authorization' => 'Bearer ' . $secret,
				'Content-Type'  => 'application/x-www-form-urlencoded',
				'Accept'        => 'application/json',
			],
			'body'    => http_build_query( $body ),
		] );
		return $this->decode( $response );
	}

	/** GET from Stripe. Returns decoded body array or WP_Error. */
	private function api_get( string $path ) {
		$secret = $this->get_secret_key();
		if ( '' === $secret ) {
			return new WP_Error( 'stripe_not_configured', 'Stripe secret key is not configured.' );
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
			return new WP_Error( 'stripe_http_error', 'Could not reach Stripe: ' . $response->get_error_message() );
		}
		$decoded = json_decode( (string) wp_remote_retrieve_body( $response ), true );
		if ( ! is_array( $decoded ) ) {
			return new WP_Error( 'stripe_bad_response', 'Unexpected response from Stripe.' );
		}
		return $decoded;
	}
}

/**
 * PayPal implementation of {@see AgentMesh_Payment_Provider}.
 *
 * Redirect / hosted-approval flow via PayPal Orders v2 (intent=CAPTURE) — the same
 * UX as Stripe/Paystack card: the buyer taps a link, approves on PayPal, returns.
 * PayPal's hosted page also offers guest-card, so this advertises the `card` channel
 * (no mobile money / OTP).
 *
 * PCI: never collects/transmits/logs a card PAN/CVV/expiry; PayPal hosts the form.
 * Amount + currency are ALWAYS derived from the WooCommerce order.
 */
class AgentMesh_PayPal_Provider implements AgentMesh_Payment_Provider {

	const LIVE_BASE    = 'https://api-m.paypal.com';
	const SANDBOX_BASE = 'https://api-m.sandbox.paypal.com';

	/**
	 * Currencies PayPal settles in. PayPal rejects others (e.g. GHS, NGN), so the
	 * gateway hides itself from the picker for an unsupported order currency.
	 * https://developer.paypal.com/api/rest/reference/currency-codes/
	 */
	const SUPPORTED_CURRENCIES = [
		'AUD', 'BRL', 'CAD', 'CHF', 'CZK', 'DKK', 'EUR', 'GBP', 'HKD', 'HUF',
		'ILS', 'JPY', 'MXN', 'NOK', 'NZD', 'PHP', 'PLN', 'SEK', 'SGD', 'THB',
		'TWD', 'USD',
	];

	public function id(): string { return 'paypal'; }
	public function label(): string { return 'PayPal'; }

	/**
	 * Resolve PayPal credentials. Prefers the official "WooCommerce PayPal Payments"
	 * options (`woocommerce-ppcp-settings`: client_id/client_secret + sandbox_on),
	 * falls back to dedicated `agentmesh_paypal_*` options.
	 *
	 * @return array{client_id:string, secret:string, mode:string}
	 */
	public function get_keys(): array {
		$plugin = get_option( 'woocommerce-ppcp-settings', [] );
		if ( is_array( $plugin ) && ( ! empty( $plugin['client_id'] ) || ! empty( $plugin['client_secret'] ) ) ) {
			$sandbox = ! empty( $plugin['sandbox_on'] );
			return [
				'client_id' => (string) ( $plugin['client_id'] ?? '' ),
				'secret'    => (string) ( $plugin['client_secret'] ?? '' ),
				'mode'      => $sandbox ? 'sandbox' : 'live',
			];
		}

		$mode = (string) get_option( 'agentmesh_paypal_mode', 'sandbox' );
		return [
			'client_id' => (string) get_option( 'agentmesh_paypal_client_id', '' ),
			'secret'    => (string) get_option( 'agentmesh_paypal_secret', '' ),
			'mode'      => 'live' === $mode ? 'live' : 'sandbox',
		];
	}

	private function api_base(): string {
		return 'live' === $this->get_keys()['mode'] ? self::LIVE_BASE : self::SANDBOX_BASE;
	}

	public function is_configured(): bool {
		$k = $this->get_keys();
		return '' !== $k['client_id'] && '' !== $k['secret'];
	}

	public function is_enabled(): bool {
		// PayPal defaults DISABLED — opt-in via the settings toggle.
		$toggle = get_option( 'agentmesh_payment_enable_paypal', 'no' );
		$on     = ! in_array( strtolower( (string) $toggle ), [ 'no', '0', '', 'false' ], true );
		return $this->is_configured() && $on;
	}

	public function get_methods( WC_Order $order ): array {
		$currency = strtoupper( $order->get_currency() );
		$methods  = in_array( $currency, self::SUPPORTED_CURRENCIES, true ) ? [ 'card' ] : [];
		return [
			'methods'                => $methods,
			'currency'               => $order->get_currency(),
			'mobile_money_providers' => [],
		];
	}

	public function initiate( WC_Order $order, string $channel, array $args ): array {
		if ( 'card' !== $channel ) {
			return $this->fail_session( $order, '', $channel, 'PayPal supports redirect checkout only.' );
		}

		$token = $this->token();
		if ( is_wp_error( $token ) ) {
			return $this->fail_session( $order, '', $channel, $token->get_error_message() );
		}

		$currency = strtoupper( $order->get_currency() );
		$value    = number_format( (float) $order->get_total(), 2, '.', '' ); // decimal, from the order

		$body = [
			'intent'         => 'CAPTURE',
			'purchase_units' => [
				[
					'custom_id' => (string) $order->get_id(),
					'amount'    => [ 'currency_code' => $currency, 'value' => $value ],
				],
			],
			'payment_source' => [
				'paypal' => [
					'experience_context' => [
						'return_url'  => $this->return_url() . '?gateway=paypal',
						'cancel_url'  => $this->return_url() . '?gateway=paypal&cancel=1',
						'user_action' => 'PAY_NOW',
					],
				],
			],
		];

		$resp = $this->api_post( '/v2/checkout/orders', $body, $token );
		if ( is_wp_error( $resp ) ) {
			return $this->fail_session( $order, '', $channel, $resp->get_error_message() );
		}

		$id  = (string) ( $resp['id'] ?? '' );
		$url = $this->approval_url( $resp );
		if ( '' === $id || '' === $url ) {
			return $this->fail_session( $order, $id, $channel, (string) ( $resp['message'] ?? 'Could not initialise PayPal checkout.' ) );
		}

		$order->update_meta_data( '_agentmesh_payment_reference', $id );
		$order->update_meta_data( '_agentmesh_payment_channel', $channel );
		$order->update_meta_data( '_agentmesh_payment_gateway', 'paypal' );
		$order->save();

		return AgentMesh_Normaliser::payment_session_to_amps( $order, [
			'reference'         => $id,
			'channel'           => $channel,
			'payment_status'    => 'awaiting_user',
			'authorization_url' => $url,
			'message'           => 'Tap the link to pay securely with PayPal.',
		] );
	}

	public function submit_otp( WC_Order $order, string $reference, string $otp ): array {
		return $this->fail_session( $order, $reference, 'card', 'PayPal payments do not use OTP.' );
	}

	public function verify( string $reference ): array {
		$token = $this->token();
		if ( is_wp_error( $token ) ) {
			return [ 'status' => 'unknown', 'amount' => 0.0, 'currency' => '', 'raw' => [] ];
		}

		$resp = $this->api_get( '/v2/checkout/orders/' . rawurlencode( $reference ), $token );
		if ( is_wp_error( $resp ) ) {
			return [ 'status' => 'unknown', 'amount' => 0.0, 'currency' => '', 'raw' => [] ];
		}

		$status = strtoupper( (string) ( $resp['status'] ?? '' ) );

		// Buyer approved on PayPal but the funds aren't captured yet — capture now
		// (idempotent: a re-capture returns ORDER_ALREADY_CAPTURED, treated as done).
		if ( 'APPROVED' === $status ) {
			$cap = $this->api_post( '/v2/checkout/orders/' . rawurlencode( $reference ) . '/capture', new stdClass(), $token );
			if ( ! is_wp_error( $cap ) ) {
				if ( 'COMPLETED' === strtoupper( (string) ( $cap['status'] ?? '' ) ) ) {
					$resp   = $cap;
					$status = 'COMPLETED';
				} elseif ( $this->already_captured( $cap ) ) {
					$status = 'COMPLETED';
				}
			}
		}

		[ $amount, $currency ] = $this->extract_amount( $resp );

		$mapped = match ( $status ) {
			'COMPLETED' => 'success',
			'VOIDED'    => 'failed',
			default     => 'pending',
		};

		return [ 'status' => $mapped, 'amount' => $amount, 'currency' => $currency, 'raw' => $resp ];
	}

	public function parse_webhook( WP_REST_Request $request ): array {
		$raw     = (string) $request->get_body();
		$payload = json_decode( $raw, true );
		$payload = is_array( $payload ) ? $payload : [];
		$event   = (string) ( $payload['event_type'] ?? '' );
		$resource = $payload['resource'] ?? [];

		// Our stored reference is the PayPal ORDER id. CHECKOUT.ORDER.* events carry it
		// as resource.id; PAYMENT.CAPTURE.* events carry it under related_ids.order_id.
		$reference = (string) (
			$resource['supplementary_data']['related_ids']['order_id']
			?? $resource['id']
			?? ''
		);

		$amt      = $resource['amount'] ?? [];
		$amount   = (float) ( $amt['value'] ?? 0 );
		$currency = strtoupper( (string) ( $amt['currency_code'] ?? '' ) );

		// Authenticity via PayPal's verify-webhook-signature API (needs a configured
		// webhook id). Unset id → valid:false; verify-on-poll remains the primary path.
		$webhook_id = (string) get_option( 'agentmesh_paypal_webhook_id', '' );
		$valid      = false;
		if ( '' !== $webhook_id && '' !== $raw ) {
			$token = $this->token();
			if ( ! is_wp_error( $token ) ) {
				$verify = $this->api_post( '/v1/notifications/verify-webhook-signature', [
					'auth_algo'         => (string) $request->get_header( 'paypal-auth-algo' ),
					'cert_url'          => (string) $request->get_header( 'paypal-cert-url' ),
					'transmission_id'   => (string) $request->get_header( 'paypal-transmission-id' ),
					'transmission_sig'  => (string) $request->get_header( 'paypal-transmission-sig' ),
					'transmission_time' => (string) $request->get_header( 'paypal-transmission-time' ),
					'webhook_id'        => $webhook_id,
					'webhook_event'     => $payload,
				], $token );
				if ( ! is_wp_error( $verify ) ) {
					$valid = 'SUCCESS' === strtoupper( (string) ( $verify['verification_status'] ?? '' ) );
				}
			}
		}

		return [
			'valid'     => $valid,
			'event'     => $event,
			'reference' => $reference,
			'amount'    => $amount,
			'currency'  => $currency,
			'raw'       => $payload,
		];
	}

	// ── Internal helpers ───────────────────────────────────────────────

	/** First approval link in an Orders v2 response (payer-action on v2, approve legacy). */
	private function approval_url( array $resp ): string {
		foreach ( (array) ( $resp['links'] ?? [] ) as $link ) {
			if ( in_array( (string) ( $link['rel'] ?? '' ), [ 'payer-action', 'approve' ], true ) ) {
				return (string) ( $link['href'] ?? '' );
			}
		}
		return '';
	}

	/** True when a capture error body says the order was already captured. */
	private function already_captured( $body ): bool {
		if ( ! is_array( $body ) ) {
			return false;
		}
		foreach ( (array) ( $body['details'] ?? [] ) as $d ) {
			if ( 'ORDER_ALREADY_CAPTURED' === ( $d['issue'] ?? '' ) ) {
				return true;
			}
		}
		return false;
	}

	/** [amount, currency] from a captured order / capture response (decimal). */
	private function extract_amount( array $resp ): array {
		$pu  = $resp['purchase_units'][0] ?? [];
		$cap = $pu['payments']['captures'][0]['amount'] ?? null;
		if ( is_array( $cap ) ) {
			return [ (float) ( $cap['value'] ?? 0 ), strtoupper( (string) ( $cap['currency_code'] ?? '' ) ) ];
		}
		$amt = $pu['amount'] ?? [];
		return [ (float) ( $amt['value'] ?? 0 ), strtoupper( (string) ( $amt['currency_code'] ?? '' ) ) ];
	}

	private function return_url(): string {
		return rest_url( AGENTMESH_REST_NAMESPACE . '/connector/payment/return' );
	}

	private function fail_session( WC_Order $order, string $reference, string $channel, string $message ): array {
		return AgentMesh_Normaliser::payment_session_to_amps( $order, [
			'reference'      => $reference,
			'channel'        => $channel,
			'payment_status' => 'failed',
			'message'        => $message,
		] );
	}

	/** OAuth2 client-credentials access token. Returns the token string or WP_Error. */
	private function token() {
		$k = $this->get_keys();
		if ( '' === $k['client_id'] || '' === $k['secret'] ) {
			return new WP_Error( 'paypal_not_configured', 'PayPal client credentials are not configured.' );
		}
		$response = wp_remote_post( $this->api_base() . '/v1/oauth2/token', [
			'timeout' => 20,
			'headers' => [
				'Authorization' => 'Basic ' . base64_encode( $k['client_id'] . ':' . $k['secret'] ),
				'Content-Type'  => 'application/x-www-form-urlencoded',
				'Accept'        => 'application/json',
			],
			'body'    => http_build_query( [ 'grant_type' => 'client_credentials' ] ),
		] );
		$decoded = $this->decode( $response );
		if ( is_wp_error( $decoded ) ) {
			return $decoded;
		}
		$tok = (string) ( $decoded['access_token'] ?? '' );
		if ( '' === $tok ) {
			return new WP_Error( 'paypal_auth_failed', (string) ( $decoded['error_description'] ?? 'PayPal authentication failed.' ) );
		}
		return $tok;
	}

	/** POST JSON to PayPal with a bearer token. Returns decoded body array or WP_Error. */
	private function api_post( string $path, $body, string $token ) {
		$response = wp_remote_post( $this->api_base() . $path, [
			'timeout' => 20,
			'headers' => [
				'Authorization' => 'Bearer ' . $token,
				'Content-Type'  => 'application/json',
				'Accept'        => 'application/json',
			],
			'body'    => wp_json_encode( $body ?: new stdClass() ),
		] );
		return $this->decode( $response );
	}

	/** GET from PayPal with a bearer token. Returns decoded body array or WP_Error. */
	private function api_get( string $path, string $token ) {
		$response = wp_remote_get( $this->api_base() . $path, [
			'timeout' => 20,
			'headers' => [
				'Authorization' => 'Bearer ' . $token,
				'Accept'        => 'application/json',
			],
		] );
		return $this->decode( $response );
	}

	private function decode( $response ) {
		if ( is_wp_error( $response ) ) {
			return new WP_Error( 'paypal_http_error', 'Could not reach PayPal: ' . $response->get_error_message() );
		}
		$decoded = json_decode( (string) wp_remote_retrieve_body( $response ), true );
		if ( ! is_array( $decoded ) ) {
			return new WP_Error( 'paypal_bad_response', 'Unexpected response from PayPal.' );
		}
		return $decoded;
	}
}

/**
 * Registry of buyer-payment gateways. Add a gateway by registering its provider
 * here — no route changes needed.
 */
class AgentMesh_Payment_Gateways {

	/** @var AgentMesh_Payment_Provider[] */
	private array $providers;

	public function __construct( ?array $providers = null ) {
		$this->providers = $providers ?? [
			new AgentMesh_Paystack_Provider(),
			new AgentMesh_Stripe_Provider(),
			new AgentMesh_PayPal_Provider(),
		];
	}

	/** @return AgentMesh_Payment_Provider[] configured + merchant-enabled providers. */
	public function enabled(): array {
		return array_values( array_filter( $this->providers, fn( $p ) => $p->is_enabled() ) );
	}

	public function get( string $id ): ?AgentMesh_Payment_Provider {
		foreach ( $this->providers as $p ) {
			if ( $p->id() === $id && $p->is_enabled() ) {
				return $p;
			}
		}
		return null;
	}

	/** First enabled provider — used when a request omits the gateway selector. */
	public function default(): ?AgentMesh_Payment_Provider {
		$enabled = $this->enabled();
		return $enabled[0] ?? null;
	}
}

/**
 * REST routes for inline payments + Paystack webhook + shared status-advance logic.
 */
class AgentMesh_Payments {

	private AgentMesh_Auth $auth;
	private AgentMesh_Payment_Gateways $gateways;

	public function __construct( ?AgentMesh_Payment_Gateways $gateways = null ) {
		$this->auth     = new AgentMesh_Auth();
		$this->gateways = $gateways ?: new AgentMesh_Payment_Gateways();
	}

	/**
	 * Resolve the provider for a request: the explicit `gateway` param if enabled,
	 * else the order's stored gateway, else the registry default. Falls back to a
	 * Paystack provider so pre-existing orders (no stored gateway) keep working.
	 */
	private function resolve_provider( WP_REST_Request $request, ?WC_Order $order = null ): AgentMesh_Payment_Provider {
		$req_gateway = sanitize_text_field( (string) ( $request->get_param( 'gateway' ) ?: '' ) );
		if ( '' !== $req_gateway ) {
			$p = $this->gateways->get( $req_gateway );
			if ( $p ) { return $p; }
		}
		if ( $order ) {
			$stored = (string) $order->get_meta( '_agentmesh_payment_gateway' );
			if ( '' !== $stored ) {
				$p = $this->gateways->get( $stored );
				if ( $p ) { return $p; }
			}
		}
		return $this->gateways->default() ?: new AgentMesh_Paystack_Provider();
	}

	/**
	 * Resolve the provider that OWNS an existing payment, from the order's stored
	 * gateway only (never the request param — the gateway is committed at initiate).
	 * Falls back to the registry default, then Paystack, so pre-existing orders work.
	 */
	private function provider_for_order( WC_Order $order ): AgentMesh_Payment_Provider {
		$stored = (string) $order->get_meta( '_agentmesh_payment_gateway' );
		if ( '' !== $stored ) {
			$p = $this->gateways->get( $stored );
			if ( $p ) { return $p; }
		}
		return $this->gateways->default() ?: new AgentMesh_Paystack_Provider();
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

		register_rest_route(
			AGENTMESH_REST_NAMESPACE,
			'/webhooks/stripe',
			[
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => [ $this, 'handle_stripe_webhook' ],
				'permission_callback' => '__return_true', // authenticity verified inside via signature
			]
		);

		register_rest_route(
			AGENTMESH_REST_NAMESPACE,
			'/webhooks/paypal',
			[
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => [ $this, 'handle_paypal_webhook' ],
				'permission_callback' => '__return_true', // authenticity verified inside via PayPal API
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

		$gateways    = [];
		$all_methods = [];
		$all_mm      = [];
		$mm_labels   = [];
		foreach ( $this->gateways->enabled() as $provider ) {
			$m          = $provider->get_methods( $order );
			$gateways[] = [
				'id'                           => $provider->id(),
				'label'                        => $provider->label(),
				'channels'                     => $m['methods'] ?? [],
				'mobile_money_providers'       => $m['mobile_money_providers'] ?? [],
				'mobile_money_provider_labels' => $m['mobile_money_provider_labels'] ?? [],
			];
			$all_methods = array_merge( $all_methods, $m['methods'] ?? [] );
			$all_mm      = array_merge( $all_mm, $m['mobile_money_providers'] ?? [] );
			$mm_labels   = array_merge( $mm_labels, $m['mobile_money_provider_labels'] ?? [] );
		}

		$response = new WP_REST_Response( [
			'gateways'                     => $gateways,
			// Legacy flat fields (union) — retained for agents that ignore `gateways`.
			'methods'                      => array_values( array_unique( $all_methods ) ),
			'currency'                     => $order->get_currency(),
			'mobile_money_providers'       => array_values( array_unique( $all_mm ) ),
			'mobile_money_provider_labels' => $mm_labels,
		], 200 );
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

		// Amount is server-derived. A pending order can be charged; a failed order is a
		// retry — WooCommerce treats both as payable, so a single declined charge must
		// not permanently brick checkout. Reset a failed order to pending for a clean
		// attempt (this also un-sticks status()/submit-otp, which short-circuit on failed).
		$order_status = $order->get_status();
		if ( 'failed' === $order_status ) {
			$order->delete_meta_data( '_agentmesh_payment_failed_at' );
			$order->set_status( 'pending', 'Retrying payment after a previous failure.' );
			$order->save();
		} elseif ( 'pending' !== $order_status ) {
			$r = new WP_REST_Response(
				AgentMesh_Auth::error_response( 'INVALID_REQUEST', 'Order is not awaiting payment (status: ' . $order_status . ').' ),
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

		$phone         = AgentMesh_Paystack_Provider::normalize_ghana_phone(
			sanitize_text_field( (string) ( $request->get_param( 'phone' ) ?: '' ) )
		);
		$provider_code = AgentMesh_Paystack_Provider::normalize_mobile_money_provider(
			sanitize_text_field( (string) ( $request->get_param( 'provider' ) ?: '' ) )
		);

		$provider = $this->resolve_provider( $request, $order );
		$session  = $provider->initiate( $order, $channel, [ 'phone' => $phone, 'provider' => $provider_code ] );

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

		$provider = $this->provider_for_order( $order );
		$session  = $provider->submit_otp( $order, $reference, $otp );

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

		// Verify-on-poll: ask the appropriate gateway for the canonical status.
		$provider = $this->provider_for_order( $order );
		$verify   = $provider->verify( $reference );

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
		$provider = $this->gateways->get( 'paystack' ) ?: new AgentMesh_Paystack_Provider();
		$parsed   = $provider->parse_webhook( $request );

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
	// POST /webhooks/stripe
	// ─────────────────────────────────────────────────────────────────

	public function handle_stripe_webhook( WP_REST_Request $request ): WP_REST_Response {
		$provider = $this->gateways->get( 'stripe' ) ?: new AgentMesh_Stripe_Provider();
		$parsed   = $provider->parse_webhook( $request );

		if ( empty( $parsed['valid'] ) ) {
			$r = new WP_REST_Response( AgentMesh_Auth::error_response( 'FORBIDDEN', 'Invalid Stripe signature.' ), 401 );
			return AgentMesh_Auth::echo_request_id( $request, $r );
		}

		$reference = (string) $parsed['reference'];
		if ( '' === $reference ) {
			$r = new WP_REST_Response( AgentMesh_Auth::error_response( 'INVALID_REQUEST', 'Missing reference in webhook.' ), 400 );
			return AgentMesh_Auth::echo_request_id( $request, $r );
		}

		$order = $this->find_order_by_reference( $reference );
		if ( ! $order ) {
			$response = new WP_REST_Response( [ 'received' => true ], 200 );
			return AgentMesh_Auth::echo_request_id( $request, $response );
		}

		if ( '' === (string) $order->get_meta( '_agentmesh_payment_gateway' ) ) {
			$order->update_meta_data( '_agentmesh_payment_gateway', 'stripe' );
			$order->save();
		}

		$event = (string) $parsed['event'];
		if ( 'checkout.session.completed' === $event ) {
			$this->advance_order_paid( $order, $reference, (float) $parsed['amount'], (string) $parsed['currency'] );
		} elseif ( in_array( $event, [ 'checkout.session.expired', 'payment_intent.payment_failed' ], true ) ) {
			$this->advance_order_failed( $order, $reference );
		}

		$response = new WP_REST_Response( [ 'received' => true ], 200 );
		return AgentMesh_Auth::echo_request_id( $request, $response );
	}

	// ─────────────────────────────────────────────────────────────────
	// POST /webhooks/paypal
	// ─────────────────────────────────────────────────────────────────

	public function handle_paypal_webhook( WP_REST_Request $request ): WP_REST_Response {
		$provider = $this->gateways->get( 'paypal' ) ?: new AgentMesh_PayPal_Provider();
		$parsed   = $provider->parse_webhook( $request );

		if ( empty( $parsed['valid'] ) ) {
			$r = new WP_REST_Response( AgentMesh_Auth::error_response( 'FORBIDDEN', 'Invalid PayPal signature.' ), 401 );
			return AgentMesh_Auth::echo_request_id( $request, $r );
		}

		$reference = (string) $parsed['reference'];
		if ( '' === $reference ) {
			$r = new WP_REST_Response( AgentMesh_Auth::error_response( 'INVALID_REQUEST', 'Missing reference in webhook.' ), 400 );
			return AgentMesh_Auth::echo_request_id( $request, $r );
		}

		$order = $this->find_order_by_reference( $reference );
		if ( ! $order ) {
			$response = new WP_REST_Response( [ 'received' => true ], 200 );
			return AgentMesh_Auth::echo_request_id( $request, $response );
		}

		if ( '' === (string) $order->get_meta( '_agentmesh_payment_gateway' ) ) {
			$order->update_meta_data( '_agentmesh_payment_gateway', 'paypal' );
			$order->save();
		}

		$event = (string) $parsed['event'];
		if ( in_array( $event, [ 'PAYMENT.CAPTURE.COMPLETED', 'CHECKOUT.ORDER.COMPLETED' ], true ) ) {
			$this->advance_order_paid( $order, $reference, (float) $parsed['amount'], (string) $parsed['currency'] );
		} elseif ( in_array( $event, [ 'PAYMENT.CAPTURE.DENIED', 'PAYMENT.CAPTURE.DECLINED', 'CHECKOUT.ORDER.VOIDED' ], true ) ) {
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
		// Paystack returns ?reference=…&trxref=…; Stripe returns ?session_id=… (the
		// Checkout Session id, which is the stored payment reference).
		// Paystack: ?reference=&trxref= · Stripe: ?session_id= · PayPal: ?token= (the order id).
		$reference = sanitize_text_field(
			(string) ( $request->get_param( 'reference' ) ?: $request->get_param( 'trxref' ) ?: $request->get_param( 'session_id' ) ?: $request->get_param( 'token' ) ?: '' )
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

		$provider = $this->provider_for_order( $order );
		$verify   = $provider->verify( $reference );
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

		return "<!doctype html>\n" .
			"<html lang=\"en\"><head><meta charset=\"utf-8\">\n" .
			"<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n" .
			"<title>" . $title . "</title>\n" .
			"<style>\n" .
			"  body{font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,sans-serif;margin:0;\n" .
			"    display:flex;min-height:100vh;align-items:center;justify-content:center;background:#f8fafc;color:#0f172a}\n" .
			"  .card{max-width:420px;padding:40px 32px;text-align:center;background:#fff;border-radius:16px;\n" .
			"    box-shadow:0 10px 30px rgba(2,6,23,.08);margin:16px}\n" .
			"  .dot{width:56px;height:56px;border-radius:50%;background:" . esc_attr( $accent ) . ";margin:0 auto 20px;\n" .
			"    display:flex;align-items:center;justify-content:center;color:#fff;font-size:28px;line-height:1}\n" .
			"  h1{font-size:20px;margin:0 0 10px}p{font-size:15px;line-height:1.5;color:#475569;margin:0}\n" .
			"</style></head>\n" .
			"<body><div class=\"card\"><div class=\"dot\">•</div><h1>" . $title . "</h1><p>" . $body . "</p></div></body></html>";
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

		if ( '' === (string) $order->get_meta( '_agentmesh_payment_gateway' ) ) {
			$order->update_meta_data( '_agentmesh_payment_gateway', 'paystack' );
		}
		$gateway_label = ucfirst( (string) $order->get_meta( '_agentmesh_payment_gateway' ) ?: 'paystack' );
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
					'%s payment amount mismatch. Expected: %s %s, Received: %s %s. Flagged for review.',
					$gateway_label,
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
			sprintf( 'Inline payment completed via %s. Reference: %s', $gateway_label, esc_html( $reference ) ),
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
		$gateway_label = ucfirst( (string) $order->get_meta( '_agentmesh_payment_gateway' ) ?: 'paystack' );
		$order->update_meta_data( '_agentmesh_payment_failed_at', current_time( 'c' ) );
		$order->update_meta_data( '_agentmesh_transaction_id', $reference );
		$order->set_status( 'failed' );
		$order->add_order_note(
			sprintf( 'Inline payment failed via %s. Reference: %s', $gateway_label, esc_html( $reference ) ),
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
		$gateway_url = get_option( 'agentmesh_gateway_url', 'https://api.synchronity.app' );
		if ( empty( $gateway_url ) ) {
			return;
		}

		$site_id       = (string) get_option( 'agentmesh_site_id', '' );
		$connector_key = (string) get_option( 'agentmesh_connector_key', '' );
		$order_id      = $order->get_id();
		$gateway       = (string) $order->get_meta( '_agentmesh_payment_gateway' ) ?: 'paystack';

		$payload = [
			'order_id'       => $order_id,
			'event'          => $event,
			'transaction_id' => $reference,
			'gateway'        => $gateway,
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
		// phpcs:disable WordPress.DB.SlowDBQuery
		$orders = wc_get_orders( [
			'limit'      => 1,
			'meta_key'   => '_agentmesh_payment_reference',
			'meta_value' => $reference,
			'return'     => 'objects',
		] );
		// phpcs:enable WordPress.DB.SlowDBQuery

		if ( is_array( $orders ) && ! empty( $orders ) ) {
			$order = $orders[0];
			return $order instanceof WC_Order ? $order : null;
		}

		return null;
	}
}
