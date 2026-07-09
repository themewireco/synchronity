<?php
/**
 * Tests for AgentMesh_Payments + AgentMesh_Paystack_Provider (inline payments).
 *
 * Paystack HTTP is mocked via a queued wp_remote_* implementation; WC_Order is a
 * lightweight in-memory stub. No real network or WP/WC install needed.
 */

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/bootstrap.php';

// ─────────────────────────────────────────────────────────────────
// Extra stubs not present in bootstrap.php
// ─────────────────────────────────────────────────────────────────

if ( ! function_exists( 'wp_remote_post' ) ) {
	$GLOBALS['_http_queue'] = [];
	$GLOBALS['_http_calls'] = [];

	function _next_http( string $method, string $url, array $args ) {
		$GLOBALS['_http_calls'][] = [ 'method' => $method, 'url' => $url, 'args' => $args ];
		if ( empty( $GLOBALS['_http_queue'] ) ) {
			return new WP_Error( 'no_mock', 'No queued HTTP response for ' . $url );
		}
		return array_shift( $GLOBALS['_http_queue'] );
	}
	function wp_remote_post( $url, $args = [] ) { return _next_http( 'POST', $url, $args ); }
	function wp_remote_get( $url, $args = [] ) { return _next_http( 'GET', $url, $args ); }
}

if ( ! function_exists( 'wp_remote_retrieve_response_code' ) ) {
	function wp_remote_retrieve_response_code( $response ): int { return $response['response']['code'] ?? 500; }
}
if ( ! function_exists( 'wp_remote_retrieve_body' ) ) {
	function wp_remote_retrieve_body( $response ): string { return $response['body'] ?? ''; }
}
if ( ! function_exists( 'sanitize_email' ) ) {
	function sanitize_email( $s ): string { return trim( (string) $s ); }
}
if ( ! function_exists( 'esc_html' ) ) {
	function esc_html( $s ): string { return htmlspecialchars( (string) $s, ENT_QUOTES, 'UTF-8' ); }
}
if ( ! function_exists( 'current_time' ) ) {
	function current_time( $fmt ): string { return gmdate( 'c' ); }
}
if ( ! function_exists( 'get_rest_url' ) ) {
	function get_rest_url( $blog_id = null, $path = '' ): string { return 'https://store.example.com/wp-json/' . ltrim( (string) $path, '/' ); }
}

if ( ! class_exists( 'WP_REST_Server' ) ) {
	class WP_REST_Server {
		const READABLE  = 'GET';
		const CREATABLE = 'POST';
	}
}

// WP_REST_Request stub in bootstrap.php lacks body helpers — add a subclass.
if ( ! method_exists( 'WP_REST_Request', 'get_body' ) ) {
	class AM_Payment_Request extends WP_REST_Request {
		private string $am_body = '';
		public function set_body( string $body ): void { $this->am_body = $body; }
		public function get_body(): string { return $this->am_body; }
	}
}

if ( ! class_exists( 'WC_Order' ) ) {
	class WC_Order {
		private array $meta = [];
		private string $status;
		private float $total;
		private string $currency;
		private string $email;
		private bool $paid = false;
		public array $notes = [];
		public int $id;
		public function __construct( int $id, float $total = 100.0, string $currency = 'GHS', string $status = 'pending', string $email = 'buyer@example.com' ) {
			$this->id = $id; $this->total = $total; $this->currency = $currency; $this->status = $status; $this->email = $email;
		}
		public function get_id(): int { return $this->id; }
		public function get_total(): float { return $this->total; }
		public function get_currency(): string { return $this->currency; }
		public function get_billing_email(): string { return $this->email; }
		public function get_status(): string { return $this->status; }
		public function set_status( string $s ): void { $this->status = $s; }
		public function is_paid(): bool { return $this->paid; }
		public function get_meta( string $key ) { return $this->meta[ $key ] ?? ''; }
		public function update_meta_data( string $key, $value ): void { $this->meta[ $key ] = $value; }
		public function delete_meta_data( string $key ): void { unset( $this->meta[ $key ] ); }
		public function add_order_note( string $note, $a = false, $b = false ): void { $this->notes[] = $note; }
		public function payment_complete( string $txn = '' ): void { $this->paid = true; $this->status = 'processing'; }
		public function save(): void {}
	}
}

if ( ! function_exists( 'wc_get_order' ) ) {
	function wc_get_order( $id ) { return $GLOBALS['_orders'][ (int) $id ] ?? false; }
}
if ( ! function_exists( 'wc_get_orders' ) ) {
	function wc_get_orders( $args = [] ) {
		$out = [];
		foreach ( $GLOBALS['_orders'] ?? [] as $order ) {
			if ( isset( $args['meta_key'] ) && $order->get_meta( $args['meta_key'] ) === $args['meta_value'] ) {
				$out[] = $order;
			}
		}
		return $out;
	}
}

require_once AGENTMESH_PLUGIN_DIR . 'includes/class-payments.php';

class PaymentsTest extends TestCase {

	protected function setUp(): void {
		global $_agentmesh_options;
		$_agentmesh_options = [
			'agentmesh_connector_key'               => 'test_key',
			'agentmesh_site_id'                     => 'site_test',
			'agentmesh_gateway_url'                 => '',
			'agentmesh_payment_enable_mobile_money' => true,
			'agentmesh_payment_enable_card'         => true,
			'agentmesh_paystack_mode'               => 'test',
			'agentmesh_paystack_test_secret_key'    => 'sk_test_123',
			'agentmesh_paystack_test_public_key'    => 'pk_test_123',
		];
		$GLOBALS['_http_queue'] = [];
		$GLOBALS['_http_calls'] = [];
		$GLOBALS['_orders']     = [];
	}

	private function queue( array $body, int $code = 200 ): void {
		$GLOBALS['_http_queue'][] = [ 'response' => [ 'code' => $code ], 'body' => json_encode( $body ) ];
	}

	private function order( int $id, float $total = 100.0, string $currency = 'GHS', string $status = 'pending' ): WC_Order {
		$o = new WC_Order( $id, $total, $currency, $status );
		$GLOBALS['_orders'][ $id ] = $o;
		return $o;
	}

	private function req( array $params = [], array $headers = [], string $body = '' ): WP_REST_Request {
		$r = method_exists( 'WP_REST_Request', 'get_body' ) ? new WP_REST_Request() : new AM_Payment_Request();
		foreach ( $params as $k => $v ) { $r->set_param( $k, $v ); }
		foreach ( $headers as $k => $v ) { $r->set_header( $k, $v ); }
		if ( '' !== $body && method_exists( $r, 'set_body' ) ) { $r->set_body( $body ); }
		return $r;
	}

	// ── methods ──────────────────────────────────────────────────

	public function test_methods_for_ghs_store(): void {
		$this->order( 1, 100.0, 'GHS' );
		$data = ( new AgentMesh_Payments() )->get_methods( $this->req( [ 'order_id' => 1 ] ) )->get_data();
		$this->assertContains( 'mobile_money', $data['methods'] );
		$this->assertContains( 'card', $data['methods'] );
		$this->assertSame( 'GHS', $data['currency'] );
		$this->assertSame( [ 'mtn', 'vod', 'tgo' ], $data['mobile_money_providers'] );
	}

	public function test_methods_hides_mobile_money_for_non_ghs(): void {
		$this->order( 2, 100.0, 'USD' );
		$data = ( new AgentMesh_Payments() )->get_methods( $this->req( [ 'order_id' => 2 ] ) )->get_data();
		$this->assertNotContains( 'mobile_money', $data['methods'] );
		$this->assertSame( [], $data['mobile_money_providers'] );
	}

	// ── initiate: mobile money ──────────────────────────────────

	public function test_initiate_mobile_money_pay_offline(): void {
		$this->order( 10, 50.0, 'GHS' );
		$this->queue( [ 'status' => true, 'data' => [ 'status' => 'pay_offline', 'reference' => 'amref_x', 'id' => 9001, 'display_text' => 'Approve on phone' ] ] );
		$resp = ( new AgentMesh_Payments() )->initiate( $this->req( [ 'order_id' => 10, 'channel' => 'mobile_money', 'phone' => '0551234567', 'provider' => 'mtn' ] ) );
		$data = $resp->get_data();
		$this->assertSame( 200, $resp->get_status() );
		$this->assertSame( 'awaiting_user', $data['payment_status'] );
		$this->assertSame( 'approve_on_phone', $data['instruction']['action'] );
		$call = $GLOBALS['_http_calls'][0];
		$this->assertSame( 'https://api.paystack.co/charge', $call['url'] );
		$sent = json_decode( $call['args']['body'], true );
		$this->assertSame( 5000, $sent['amount'] ); // 50.00 → pesewas
		$this->assertSame( 'GHS', $sent['currency'] );
		$this->assertStringContainsString( 'Bearer sk_test_123', $call['args']['headers']['Authorization'] );
		$this->assertSame( 'amref_x', wc_get_order( 10 )->get_meta( '_agentmesh_payment_reference' ) );
	}

	public function test_normalize_telecel_provider_alias(): void {
		$this->order( 14, 50.0, 'GHS' );
		$this->queue( [ 'status' => true, 'data' => [ 'status' => 'send_otp', 'reference' => 'amref_tc', 'display_text' => 'Enter OTP' ] ] );
		$data = ( new AgentMesh_Payments() )->initiate(
			$this->req( [ 'order_id' => 14, 'channel' => 'mobile_money', 'phone' => '+233551234567', 'provider' => 'telecel' ] )
		)->get_data();
		$this->assertSame( 'submit_otp', $data['instruction']['action'] );
		$sent = json_decode( $GLOBALS['_http_calls'][0]['args']['body'], true );
		$this->assertSame( 'vod', $sent['mobile_money']['provider'] );
		$this->assertSame( '0551234567', $sent['mobile_money']['phone'] );
	}

	public function test_initiate_mobile_money_send_otp(): void {
		$this->order( 11, 50.0, 'GHS' );
		$this->queue( [ 'status' => true, 'data' => [ 'status' => 'send_otp', 'reference' => 'amref_otp', 'display_text' => 'Enter OTP' ] ] );
		$data = ( new AgentMesh_Payments() )->initiate( $this->req( [ 'order_id' => 11, 'channel' => 'mobile_money', 'phone' => '0551234567', 'provider' => 'mtn' ] ) )->get_data();
		$this->assertSame( 'awaiting_user', $data['payment_status'] );
		$this->assertSame( 'submit_otp', $data['instruction']['action'] );
	}

	public function test_initiate_rejects_bad_provider(): void {
		$this->order( 12, 50.0, 'GHS' );
		$data = ( new AgentMesh_Payments() )->initiate( $this->req( [ 'order_id' => 12, 'channel' => 'mobile_money', 'phone' => '055', 'provider' => 'bogus' ] ) )->get_data();
		$this->assertSame( 'failed', $data['payment_status'] );
	}

	public function test_initiate_rejects_non_pending_order(): void {
		$this->order( 13, 50.0, 'GHS', 'processing' );
		$resp = ( new AgentMesh_Payments() )->initiate( $this->req( [ 'order_id' => 13, 'channel' => 'mobile_money', 'phone' => '0551234567', 'provider' => 'mtn' ] ) );
		$this->assertSame( 409, $resp->get_status() );
	}

	// ── initiate: card ──────────────────────────────────────────

	public function test_initiate_card_returns_authorization_url(): void {
		$this->order( 20, 75.0, 'GHS' );
		$this->queue( [ 'status' => true, 'data' => [ 'authorization_url' => 'https://checkout.paystack.com/abc', 'reference' => 'amref_card', 'id' => 7700 ] ] );
		$data = ( new AgentMesh_Payments() )->initiate( $this->req( [ 'order_id' => 20, 'channel' => 'card' ] ) )->get_data();
		$this->assertSame( 'awaiting_user', $data['payment_status'] );
		$this->assertSame( 'redirect', $data['instruction']['action'] );
		$this->assertSame( 'https://checkout.paystack.com/abc', $data['instruction']['authorization_url'] );
		$call = $GLOBALS['_http_calls'][0];
		$this->assertSame( 'https://api.paystack.co/transaction/initialize', $call['url'] );
		$this->assertSame( 7500, json_decode( $call['args']['body'], true )['amount'] );
	}

	// ── submit-otp ──────────────────────────────────────────────

	public function test_submit_otp_success(): void {
		$o = $this->order( 30, 50.0, 'GHS' );
		$o->update_meta_data( '_agentmesh_payment_reference', 'amref_otp2' );
		$o->update_meta_data( '_agentmesh_payment_channel', 'mobile_money' );
		$this->queue( [ 'status' => true, 'data' => [ 'status' => 'success', 'reference' => 'amref_otp2' ] ] );
		$data = ( new AgentMesh_Payments() )->submit_otp( $this->req( [ 'order_id' => 30, 'otp' => '123456' ] ) )->get_data();
		$this->assertSame( 'processing', $data['payment_status'] );
		$call = $GLOBALS['_http_calls'][0];
		$this->assertSame( 'https://api.paystack.co/charge/submit_otp', $call['url'] );
		$sent = json_decode( $call['args']['body'], true );
		$this->assertSame( '123456', $sent['otp'] );
		$this->assertSame( 'amref_otp2', $sent['reference'] );
	}

	public function test_submit_otp_requires_otp(): void {
		$this->order( 31, 50.0, 'GHS' );
		$resp = ( new AgentMesh_Payments() )->submit_otp( $this->req( [ 'order_id' => 31 ] ) );
		$this->assertSame( 400, $resp->get_status() );
	}

	// ── status / verify-on-poll ─────────────────────────────────

	public function test_status_verify_success_advances_order(): void {
		$o = $this->order( 40, 50.0, 'GHS' );
		$o->update_meta_data( '_agentmesh_payment_reference', 'amref_poll' );
		$this->queue( [ 'status' => true, 'data' => [ 'status' => 'success', 'amount' => 5000, 'currency' => 'GHS' ] ] );
		$data = ( new AgentMesh_Payments() )->status( $this->req( [ 'order_id' => 40 ] ) )->get_data();
		$this->assertSame( 'paid', $data['payment_status'] );
		$this->assertSame( 'processing', wc_get_order( 40 )->get_status() );
		$this->assertTrue( wc_get_order( 40 )->is_paid() );
	}

	public function test_status_pending_stays_awaiting(): void {
		$o = $this->order( 41, 50.0, 'GHS' );
		$o->update_meta_data( '_agentmesh_payment_reference', 'amref_pend' );
		$this->queue( [ 'status' => true, 'data' => [ 'status' => 'pending', 'amount' => 5000, 'currency' => 'GHS' ] ] );
		$data = ( new AgentMesh_Payments() )->status( $this->req( [ 'order_id' => 41 ] ) )->get_data();
		$this->assertSame( 'awaiting_user', $data['payment_status'] );
		$this->assertSame( 'pending', wc_get_order( 41 )->get_status() );
	}

	public function test_status_already_paid_skips_verify(): void {
		$o = $this->order( 42, 50.0, 'GHS', 'processing' );
		$o->update_meta_data( '_agentmesh_payment_reference', 'amref_done' );
		$data = ( new AgentMesh_Payments() )->status( $this->req( [ 'order_id' => 42 ] ) )->get_data();
		$this->assertSame( 'paid', $data['payment_status'] );
		$this->assertCount( 0, $GLOBALS['_http_calls'] );
	}

	// ── webhook ─────────────────────────────────────────────────

	public function test_webhook_valid_signature_advances_order(): void {
		$o = $this->order( 50, 50.0, 'GHS' );
		$o->update_meta_data( '_agentmesh_payment_reference', 'amref_wh' );
		$payload = json_encode( [ 'event' => 'charge.success', 'data' => [ 'reference' => 'amref_wh', 'amount' => 5000, 'currency' => 'GHS' ] ] );
		$sig = hash_hmac( 'sha512', $payload, 'sk_test_123' );
		$resp = ( new AgentMesh_Payments() )->handle_paystack_webhook( $this->req( [], [ 'x-paystack-signature' => $sig ], $payload ) );
		$this->assertSame( 200, $resp->get_status() );
		$this->assertSame( 'processing', wc_get_order( 50 )->get_status() );
	}

	public function test_webhook_is_idempotent(): void {
		$o = $this->order( 50, 50.0, 'GHS' );
		$o->update_meta_data( '_agentmesh_payment_reference', 'amref_wh' );
		$payload = json_encode( [ 'event' => 'charge.success', 'data' => [ 'reference' => 'amref_wh', 'amount' => 5000, 'currency' => 'GHS' ] ] );
		$sig = hash_hmac( 'sha512', $payload, 'sk_test_123' );
		$payments = new AgentMesh_Payments();
		$payments->handle_paystack_webhook( $this->req( [], [ 'x-paystack-signature' => $sig ], $payload ) );
		$notes_before = count( wc_get_order( 50 )->notes );
		$resp = $payments->handle_paystack_webhook( $this->req( [], [ 'x-paystack-signature' => $sig ], $payload ) );
		$this->assertSame( 200, $resp->get_status() );
		$this->assertCount( $notes_before, wc_get_order( 50 )->notes );
	}

	public function test_webhook_bad_signature_rejected(): void {
		$o = $this->order( 51, 50.0, 'GHS' );
		$o->update_meta_data( '_agentmesh_payment_reference', 'amref_bad' );
		$payload = json_encode( [ 'event' => 'charge.success', 'data' => [ 'reference' => 'amref_bad', 'amount' => 5000, 'currency' => 'GHS' ] ] );
		$resp = ( new AgentMesh_Payments() )->handle_paystack_webhook( $this->req( [], [ 'x-paystack-signature' => 'deadbeef' ], $payload ) );
		$this->assertSame( 401, $resp->get_status() );
		$this->assertSame( 'pending', wc_get_order( 51 )->get_status() );
	}

	public function test_webhook_charge_failed_marks_failed(): void {
		$o = $this->order( 52, 50.0, 'GHS' );
		$o->update_meta_data( '_agentmesh_payment_reference', 'amref_fail' );
		$payload = json_encode( [ 'event' => 'charge.failed', 'data' => [ 'reference' => 'amref_fail' ] ] );
		$sig = hash_hmac( 'sha512', $payload, 'sk_test_123' );
		( new AgentMesh_Payments() )->handle_paystack_webhook( $this->req( [], [ 'x-paystack-signature' => $sig ], $payload ) );
		$this->assertSame( 'failed', wc_get_order( 52 )->get_status() );
	}

	public function test_webhook_unknown_reference_acknowledged(): void {
		$payload = json_encode( [ 'event' => 'charge.success', 'data' => [ 'reference' => 'not_ours', 'amount' => 5000, 'currency' => 'GHS' ] ] );
		$sig = hash_hmac( 'sha512', $payload, 'sk_test_123' );
		$resp = ( new AgentMesh_Payments() )->handle_paystack_webhook( $this->req( [], [ 'x-paystack-signature' => $sig ], $payload ) );
		$this->assertSame( 200, $resp->get_status() );
	}

	// ── key resolution ──────────────────────────────────────────

	public function test_keys_prefer_paystack_plugin_options(): void {
		global $_agentmesh_options;
		$_agentmesh_options['woocommerce_paystack_settings'] = [
			'testmode'        => 'no',
			'live_secret_key' => 'sk_live_PLUGIN',
			'live_public_key' => 'pk_live_PLUGIN',
		];
		$keys = ( new AgentMesh_Paystack_Provider() )->get_keys();
		$this->assertSame( 'live', $keys['mode'] );
		$this->assertSame( 'sk_live_PLUGIN', $keys['secret_key'] );
	}

	public function test_keys_fall_back_to_agentmesh_options(): void {
		$keys = ( new AgentMesh_Paystack_Provider() )->get_keys();
		$this->assertSame( 'test', $keys['mode'] );
		$this->assertSame( 'sk_test_123', $keys['secret_key'] );
	}

	// ── normaliser PaymentSession ───────────────────────────────

	public function test_payment_session_card_shape(): void {
		$o = new WC_Order( 60, 50.0, 'GHS' );
		$session = AgentMesh_Normaliser::payment_session_to_amps( $o, [
			'reference'         => 'amref_n',
			'channel'           => 'card',
			'payment_status'    => 'awaiting_user',
			'authorization_url' => 'https://checkout.paystack.com/z',
		] );
		$this->assertSame( '60', $session['order_id'] );
		$this->assertSame( 'card', $session['instruction']['channel'] );
		$this->assertSame( 'redirect', $session['instruction']['action'] );
	}

	public function test_payment_session_terminal_has_no_instruction(): void {
		$o = new WC_Order( 61, 50.0, 'GHS' );
		$session = AgentMesh_Normaliser::payment_session_to_amps( $o, [ 'channel' => 'mobile_money', 'payment_status' => 'paid' ] );
		$this->assertArrayNotHasKey( 'instruction', $session );
	}

	// ── PayPal provider ─────────────────────────────────────────

	private function enable_paypal(): void {
		global $_agentmesh_options;
		$_agentmesh_options['agentmesh_payment_enable_paypal'] = 'yes';
		$_agentmesh_options['agentmesh_paypal_mode']           = 'sandbox';
		$_agentmesh_options['agentmesh_paypal_client_id']      = 'cid_test';
		$_agentmesh_options['agentmesh_paypal_secret']         = 'csec_test';
	}

	public function test_paypal_methods_supported_currency(): void {
		$this->enable_paypal();
		$o = new WC_Order( 100, 25.0, 'USD' );
		$m = ( new AgentMesh_PayPal_Provider() )->get_methods( $o );
		$this->assertSame( [ 'card' ], $m['methods'] );
	}

	public function test_paypal_methods_hidden_for_unsupported_currency(): void {
		$this->enable_paypal();
		$o = new WC_Order( 101, 25.0, 'GHS' );
		$m = ( new AgentMesh_PayPal_Provider() )->get_methods( $o );
		$this->assertSame( [], $m['methods'] );
	}

	public function test_paypal_is_enabled_requires_keys_and_toggle(): void {
		$p = new AgentMesh_PayPal_Provider();
		$this->assertFalse( $p->is_enabled() ); // off by default, no keys
		$this->enable_paypal();
		$this->assertTrue( ( new AgentMesh_PayPal_Provider() )->is_enabled() );
	}

	public function test_paypal_initiate_returns_authorization_url(): void {
		$this->enable_paypal();
		$this->order( 110, 30.0, 'USD' );
		// 1) OAuth token, 2) create order
		$this->queue( [ 'access_token' => 'A123', 'token_type' => 'Bearer' ] );
		$this->queue( [
			'id'     => 'PPORDER1',
			'status' => 'PAYER_ACTION_REQUIRED',
			'links'  => [
				[ 'rel' => 'self', 'href' => 'https://api/x' ],
				[ 'rel' => 'payer-action', 'href' => 'https://www.paypal.com/checkoutnow?token=PPORDER1' ],
			],
		] );
		$data = ( new AgentMesh_Payments() )->initiate( $this->req( [ 'order_id' => 110, 'channel' => 'card', 'gateway' => 'paypal' ] ) )->get_data();
		$this->assertSame( 'awaiting_user', $data['payment_status'] );
		$this->assertSame( 'redirect', $data['instruction']['action'] );
		$this->assertSame( 'https://www.paypal.com/checkoutnow?token=PPORDER1', $data['instruction']['authorization_url'] );
		$o = wc_get_order( 110 );
		$this->assertSame( 'PPORDER1', $o->get_meta( '_agentmesh_payment_reference' ) );
		$this->assertSame( 'paypal', $o->get_meta( '_agentmesh_payment_gateway' ) );
		// OAuth call used Basic auth; create-order call posted decimal value.
		$this->assertStringContainsString( 'Basic ', $GLOBALS['_http_calls'][0]['args']['headers']['Authorization'] );
		$sent = json_decode( $GLOBALS['_http_calls'][1]['args']['body'], true );
		$this->assertSame( '30.00', $sent['purchase_units'][0]['amount']['value'] );
		$this->assertSame( 'USD', $sent['purchase_units'][0]['amount']['currency_code'] );
	}

	public function test_paypal_verify_completed_is_success(): void {
		$this->enable_paypal();
		$this->queue( [ 'access_token' => 'A123' ] );
		$this->queue( [
			'id'             => 'PPORDER2',
			'status'         => 'COMPLETED',
			'purchase_units' => [ [ 'payments' => [ 'captures' => [ [ 'amount' => [ 'value' => '40.00', 'currency_code' => 'USD' ] ] ] ] ] ],
		] );
		$v = ( new AgentMesh_PayPal_Provider() )->verify( 'PPORDER2' );
		$this->assertSame( 'success', $v['status'] );
		$this->assertSame( 40.0, $v['amount'] );
		$this->assertSame( 'USD', $v['currency'] );
	}

	public function test_paypal_verify_approved_triggers_capture(): void {
		$this->enable_paypal();
		$this->queue( [ 'access_token' => 'A123' ] );                                   // token
		$this->queue( [ 'id' => 'PPORDER3', 'status' => 'APPROVED' ] );                 // GET order
		$this->queue( [                                                                // capture
			'id'             => 'PPORDER3',
			'status'         => 'COMPLETED',
			'purchase_units' => [ [ 'payments' => [ 'captures' => [ [ 'amount' => [ 'value' => '12.50', 'currency_code' => 'USD' ] ] ] ] ] ],
		] );
		$v = ( new AgentMesh_PayPal_Provider() )->verify( 'PPORDER3' );
		$this->assertSame( 'success', $v['status'] );
		$this->assertSame( 12.5, $v['amount'] );
		$this->assertStringContainsString( '/v2/checkout/orders/PPORDER3/capture', $GLOBALS['_http_calls'][2]['url'] );
	}

	public function test_paypal_verify_already_captured_is_success(): void {
		$this->enable_paypal();
		$this->queue( [ 'access_token' => 'A123' ] );
		$this->queue( [
			'id'             => 'PPORDER4',
			'status'         => 'APPROVED',
			'purchase_units' => [ [ 'amount' => [ 'value' => '9.00', 'currency_code' => 'USD' ] ] ],
		] );
		$this->queue( [ 'name' => 'UNPROCESSABLE_ENTITY', 'details' => [ [ 'issue' => 'ORDER_ALREADY_CAPTURED' ] ] ], 422 );
		$v = ( new AgentMesh_PayPal_Provider() )->verify( 'PPORDER4' );
		$this->assertSame( 'success', $v['status'] );
		$this->assertSame( 9.0, $v['amount'] );
	}

	public function test_paypal_verify_voided_is_failed(): void {
		$this->enable_paypal();
		$this->queue( [ 'access_token' => 'A123' ] );
		$this->queue( [ 'id' => 'PPORDER5', 'status' => 'VOIDED' ] );
		$v = ( new AgentMesh_PayPal_Provider() )->verify( 'PPORDER5' );
		$this->assertSame( 'failed', $v['status'] );
	}

	public function test_paypal_keys_prefer_ppcp_plugin_options(): void {
		global $_agentmesh_options;
		$_agentmesh_options['woocommerce-ppcp-settings'] = [
			'client_id'     => 'cid_PLUGIN',
			'client_secret' => 'csec_PLUGIN',
			'sandbox_on'    => false,
		];
		$keys = ( new AgentMesh_PayPal_Provider() )->get_keys();
		$this->assertSame( 'live', $keys['mode'] );
		$this->assertSame( 'cid_PLUGIN', $keys['client_id'] );
		$this->assertSame( 'csec_PLUGIN', $keys['secret'] );
	}

	public function test_paypal_registry_resolves_when_enabled(): void {
		$this->enable_paypal();
		$gw = new AgentMesh_Payment_Gateways();
		$this->assertNotNull( $gw->get( 'paypal' ) );
		$ids = array_map( fn( $p ) => $p->id(), $gw->enabled() );
		$this->assertContains( 'paypal', $ids );
	}
}
