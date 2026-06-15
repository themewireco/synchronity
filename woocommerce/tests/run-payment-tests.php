#!/usr/bin/env php
<?php
/**
 * Self-contained test runner for the inline-payments connector layer
 * (class-payments.php + normaliser PaymentSession additions).
 *
 * Runs without Composer/PHPUnit:  php tests/run-payment-tests.php
 *
 * Mocks Paystack HTTP via a queued wp_remote_* implementation and a minimal
 * WC_Order / wc_get_order(s) stub.
 */

error_reporting( E_ALL );
ini_set( 'display_errors', '1' );

define( 'ABSPATH', __DIR__ . '/' );
define( 'AGENTMESH_VERSION', '0.1.0' );
define( 'AGENTMESH_PLUGIN_DIR', dirname( __DIR__ ) . '/' );
define( 'AGENTMESH_REST_NAMESPACE', 'agentmesh/v1' );

// ─────────────────────────────────────────────────────────────────
// HTTP mock plumbing
// ─────────────────────────────────────────────────────────────────

$GLOBALS['_http_queue']  = [];   // queued responses (FIFO)
$GLOBALS['_http_calls']  = [];   // recorded requests

function _queue_http( array $body, int $code = 200 ): void {
	$GLOBALS['_http_queue'][] = [ 'response' => [ 'code' => $code ], 'body' => json_encode( $body ) ];
}

function _next_http( string $method, string $url, array $args ) {
	$GLOBALS['_http_calls'][] = [ 'method' => $method, 'url' => $url, 'args' => $args ];
	if ( empty( $GLOBALS['_http_queue'] ) ) {
		return new WP_Error( 'no_mock', 'No queued HTTP response for ' . $url );
	}
	return array_shift( $GLOBALS['_http_queue'] );
}

// ─────────────────────────────────────────────────────────────────
// WordPress / WooCommerce stubs
// ─────────────────────────────────────────────────────────────────

$_agentmesh_options = [];

function get_option( $key, $default = false ) {
	global $_agentmesh_options;
	return $_agentmesh_options[ $key ] ?? $default;
}

function wp_remote_post( $url, $args = [] ) { return _next_http( 'POST', $url, $args ); }
function wp_remote_get( $url, $args = [] )  { return _next_http( 'GET', $url, $args ); }
function wp_remote_retrieve_response_code( $response ): int { return $response['response']['code'] ?? 500; }
function wp_remote_retrieve_body( $response ): string { return $response['body'] ?? ''; }
function wp_json_encode( $data ): string { return json_encode( $data ); }
function trailingslashit( $value ): string { return rtrim( $value, '/' ) . '/'; }
function is_wp_error( $thing ): bool { return $thing instanceof WP_Error; }
function sanitize_text_field( $str ): string { return trim( strip_tags( (string) $str ) ); }
function sanitize_email( $str ): string { return trim( (string) $str ); }
function sanitize_textarea_field( $str ): string { return trim( (string) $str ); }
function esc_html( $str ): string { return htmlspecialchars( (string) $str, ENT_QUOTES, 'UTF-8' ); }
function current_time( $fmt ): string { return gmdate( 'c' ); }
function get_site_url(): string { return 'https://store.example.com'; }
function get_woocommerce_currency(): string { return 'GHS'; }
function rest_url( $path = '' ): string { return 'https://store.example.com/wp-json/' . ltrim( (string) $path, '/' ); }
function status_header( $code ) { return $code; }
// hash_equals() is native in PHP 5.6+ — no stub needed.

class WP_Error {
	public function __construct(
		public string $code = '',
		public string $message = '',
		public mixed $data = null
	) {}
	public function get_error_message(): string { return $this->message; }
}

class WP_REST_Server {
	const READABLE  = 'GET';
	const CREATABLE = 'POST';
}

class WP_REST_Request {
	private array $params  = [];
	private array $headers = [];
	private string $body   = '';
	public function set_param( string $key, mixed $value ): void { $this->params[ $key ] = $value; }
	public function get_param( string $key ): mixed { return $this->params[ $key ] ?? null; }
	public function get_header( string $key ): ?string { return $this->headers[ strtolower( $key ) ] ?? null; }
	public function set_header( string $key, string $value ): void { $this->headers[ strtolower( $key ) ] = $value; }
	public function set_body( string $body ): void { $this->body = $body; }
	public function get_body(): string { return $this->body; }
}

class WP_REST_Response {
	private array $headers = [];
	public function __construct( public mixed $data = null, public int $status = 200 ) {}
	public function header( string $key, string $value ): void { $this->headers[ $key ] = $value; }
	public function get_data(): mixed { return $this->data; }
	public function get_status(): int { return $this->status; }
	public function get_headers(): array { return $this->headers; }
}

// Minimal WC_Order stub with in-memory meta + status.
class WC_Order {
	private array $meta   = [];
	private string $status;
	private float $total;
	private string $currency;
	private string $email;
	private bool $paid    = false;
	public array $notes   = [];

	public function __construct( int $id, float $total = 100.0, string $currency = 'GHS', string $status = 'pending', string $email = 'buyer@example.com' ) {
		$this->id       = $id;
		$this->total    = $total;
		$this->currency = $currency;
		$this->status   = $status;
		$this->email    = $email;
	}
	public int $id;
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

$GLOBALS['_orders'] = [];
function wc_get_order( $id ) {
	return $GLOBALS['_orders'][ (int) $id ] ?? false;
}
function wc_get_orders( $args = [] ) {
	$out = [];
	foreach ( $GLOBALS['_orders'] as $order ) {
		if ( isset( $args['meta_key'] ) && $order->get_meta( $args['meta_key'] ) === $args['meta_value'] ) {
			$out[] = $order;
		}
	}
	return $out;
}

// ─────────────────────────────────────────────────────────────────
// Load code under test
// ─────────────────────────────────────────────────────────────────

require_once AGENTMESH_PLUGIN_DIR . 'includes/class-auth.php';
require_once AGENTMESH_PLUGIN_DIR . 'includes/class-normaliser.php';
require_once AGENTMESH_PLUGIN_DIR . 'includes/class-payments.php';

// ─────────────────────────────────────────────────────────────────
// Tiny assertion harness
// ─────────────────────────────────────────────────────────────────

$tests_passed = 0;
$tests_failed = 0;
$details      = [];

function ok( bool $cond, string $name ): void {
	global $tests_passed, $tests_failed, $details;
	if ( $cond ) { $tests_passed++; $details[] = "✓ $name"; }
	else { $tests_failed++; $details[] = "✗ $name"; }
}
function eq( $expected, $actual, string $name ): void {
	global $tests_passed, $tests_failed, $details;
	if ( $expected === $actual ) { $tests_passed++; $details[] = "✓ $name"; }
	else { $tests_failed++; $details[] = "✗ $name (expected " . var_export( $expected, true ) . ", got " . var_export( $actual, true ) . ")"; }
}

function reset_world(): void {
	global $_agentmesh_options;
	$_agentmesh_options = [
		'agentmesh_connector_key'                 => 'test_key',
		'agentmesh_site_id'                       => 'site_test',
		'agentmesh_gateway_url'                   => '',
		'agentmesh_payment_enable_mobile_money'   => true,
		'agentmesh_payment_enable_card'           => true,
		'agentmesh_paystack_mode'                 => 'test',
		'agentmesh_paystack_test_secret_key'      => 'sk_test_123',
		'agentmesh_paystack_test_public_key'      => 'pk_test_123',
	];
	$GLOBALS['_http_queue'] = [];
	$GLOBALS['_http_calls'] = [];
	$GLOBALS['_orders']     = [];
}

function add_order( WC_Order $o ): WC_Order {
	$GLOBALS['_orders'][ $o->get_id() ] = $o;
	return $o;
}

function req( array $params = [], array $headers = [], string $body = '' ): WP_REST_Request {
	$r = new WP_REST_Request();
	foreach ( $params as $k => $v ) { $r->set_param( $k, $v ); }
	foreach ( $headers as $k => $v ) { $r->set_header( $k, $v ); }
	if ( '' !== $body ) { $r->set_body( $body ); }
	return $r;
}

echo "Running Inline Payments Tests...\n";
echo "================================\n\n";

// ─────────────────────────────────────────────────────────────────
// methods
// ─────────────────────────────────────────────────────────────────
echo "GET /connector/payment/methods:\n";

reset_world();
add_order( new WC_Order( 1, 100.0, 'GHS' ) );
$payments = new AgentMesh_Payments();
$resp = $payments->get_methods( req( [ 'order_id' => 1 ] ) );
$data = $resp->get_data();
eq( 200, $resp->get_status(), 'methods returns 200' );
ok( in_array( 'mobile_money', $data['methods'], true ), 'GHS store offers mobile_money' );
ok( in_array( 'card', $data['methods'], true ), 'store offers card' );
eq( 'GHS', $data['currency'], 'methods echoes order currency' );
eq( [ 'mtn', 'vod', 'tgo' ], $data['mobile_money_providers'], 'lists mobile money providers' );

reset_world();
add_order( new WC_Order( 2, 100.0, 'USD' ) );
$payments = new AgentMesh_Payments();
$data = $payments->get_methods( req( [ 'order_id' => 2 ] ) )->get_data();
ok( ! in_array( 'mobile_money', $data['methods'], true ), 'non-GHS store hides mobile_money' );
eq( [], $data['mobile_money_providers'], 'no mm providers for non-GHS' );

echo "\n";

// ─────────────────────────────────────────────────────────────────
// initiate — mobile money (pay_offline / approve_on_phone)
// ─────────────────────────────────────────────────────────────────
echo "POST /connector/payment/initiate (mobile_money):\n";

reset_world();
add_order( new WC_Order( 10, 50.0, 'GHS' ) );
_queue_http( [ 'status' => true, 'data' => [ 'status' => 'pay_offline', 'reference' => 'amref_x', 'id' => 9001, 'display_text' => 'Approve on your phone' ] ] );
$payments = new AgentMesh_Payments();
$resp = $payments->initiate( req( [ 'order_id' => 10, 'channel' => 'mobile_money', 'phone' => '0551234567', 'provider' => 'mtn' ] ) );
$data = $resp->get_data();
eq( 200, $resp->get_status(), 'initiate mm returns 200' );
eq( 'awaiting_user', $data['payment_status'], 'pay_offline → awaiting_user' );
eq( 'approve_on_phone', $data['instruction']['action'], 'instruction action approve_on_phone' );
eq( 'mtn', $data['instruction']['provider'], 'instruction carries provider' );
eq( 'mobile_money', $data['channel'], 'channel is mobile_money' );
$call = $GLOBALS['_http_calls'][0];
eq( 'https://api.paystack.co/charge', $call['url'], 'initiate mm hits /charge' );
$sent = json_decode( $call['args']['body'], true );
eq( 5000, $sent['amount'], 'amount derived from order total in pesewas (50.00 → 5000)' );
eq( 'GHS', $sent['currency'], 'currency from order' );
ok( str_contains( $call['args']['headers']['Authorization'], 'Bearer sk_test_123' ), 'Bearer secret on charge' );
$ord = wc_get_order( 10 );
eq( 'amref_x', $ord->get_meta( '_agentmesh_payment_reference' ), 'reference stored on order' );
eq( '9001', $ord->get_meta( '_agentmesh_paystack_txn_id' ), 'paystack txn id stored' );

// send_otp branch
reset_world();
add_order( new WC_Order( 11, 50.0, 'GHS' ) );
_queue_http( [ 'status' => true, 'data' => [ 'status' => 'send_otp', 'reference' => 'amref_otp', 'display_text' => 'Enter OTP' ] ] );
$payments = new AgentMesh_Payments();
$data = $payments->initiate( req( [ 'order_id' => 11, 'channel' => 'mobile_money', 'phone' => '0551234567', 'provider' => 'mtn' ] ) )->get_data();
eq( 'awaiting_user', $data['payment_status'], 'send_otp → awaiting_user' );
eq( 'submit_otp', $data['instruction']['action'], 'send_otp instruction action submit_otp' );

// rejects bad provider
reset_world();
add_order( new WC_Order( 12, 50.0, 'GHS' ) );
$payments = new AgentMesh_Payments();
$data = $payments->initiate( req( [ 'order_id' => 12, 'channel' => 'mobile_money', 'phone' => '055', 'provider' => 'bogus' ] ) )->get_data();
eq( 'failed', $data['payment_status'], 'bad provider → failed session' );

// rejects a terminal (non-payable) order — processing stays 409
reset_world();
add_order( new WC_Order( 13, 50.0, 'GHS', 'processing' ) );
$payments = new AgentMesh_Payments();
$resp = $payments->initiate( req( [ 'order_id' => 13, 'channel' => 'mobile_money', 'phone' => '0551234567', 'provider' => 'mtn' ] ) );
eq( 409, $resp->get_status(), 'non-payable (processing) order rejected with 409' );

// a failed order is retryable — a single decline must not brick checkout.
// Woo treats failed as payable; initiate resets it to pending and charges afresh.
reset_world();
$failed = add_order( new WC_Order( 14, 50.0, 'GHS', 'failed' ) );
$failed->update_meta_data( '_agentmesh_payment_failed_at', '2026-06-09T00:00:00+00:00' );
_queue_http( [ 'status' => true, 'data' => [ 'status' => 'send_otp', 'reference' => 'amref_retry', 'display_text' => 'Enter OTP' ] ] );
$payments = new AgentMesh_Payments();
$resp = $payments->initiate( req( [ 'order_id' => 14, 'channel' => 'mobile_money', 'phone' => '0551234567', 'provider' => 'mtn' ] ) );
eq( 200, $resp->get_status(), 'failed order retry returns 200' );
eq( 'awaiting_user', $resp->get_data()['payment_status'], 'failed order retry → awaiting_user' );
eq( 'pending', wc_get_order( 14 )->get_status(), 'failed order reset to pending on retry' );
eq( '', wc_get_order( 14 )->get_meta( '_agentmesh_payment_failed_at' ), 'stale failed-at meta cleared on retry' );
eq( 'amref_retry', wc_get_order( 14 )->get_meta( '_agentmesh_payment_reference' ), 'fresh reference stored on retry' );

echo "\n";

// ─────────────────────────────────────────────────────────────────
// initiate — card (redirect)
// ─────────────────────────────────────────────────────────────────
echo "POST /connector/payment/initiate (card):\n";

reset_world();
add_order( new WC_Order( 20, 75.0, 'GHS' ) );
_queue_http( [ 'status' => true, 'data' => [ 'authorization_url' => 'https://checkout.paystack.com/abc', 'reference' => 'amref_card', 'id' => 7700 ] ] );
$payments = new AgentMesh_Payments();
$data = $payments->initiate( req( [ 'order_id' => 20, 'channel' => 'card' ] ) )->get_data();
eq( 'awaiting_user', $data['payment_status'], 'card init → awaiting_user' );
eq( 'redirect', $data['instruction']['action'], 'card instruction action redirect' );
eq( 'https://checkout.paystack.com/abc', $data['instruction']['authorization_url'], 'authorization_url passed through' );
$call = $GLOBALS['_http_calls'][0];
eq( 'https://api.paystack.co/transaction/initialize', $call['url'], 'card hits /transaction/initialize' );
$sent = json_decode( $call['args']['body'], true );
eq( 7500, $sent['amount'], 'card amount in pesewas (75.00 → 7500)' );
// Regression: card MUST send an explicit callback_url to the GET return landing,
// NOT the POST-only webhook (otherwise the browser hits a 404 after paying).
eq( 'https://store.example.com/wp-json/agentmesh/v1/connector/payment/return', $sent['callback_url'] ?? '', 'card sends callback_url to the return landing' );
$truthy = isset( $sent['callback_url'] ) && false === strpos( $sent['callback_url'], '/webhooks/paystack' );
eq( true, $truthy, 'callback_url is NOT the webhook endpoint' );

echo "\n";

// ─────────────────────────────────────────────────────────────────
// card return landing (Paystack callback_url GET)
// ─────────────────────────────────────────────────────────────────
echo "GET /connector/payment/return:\n";

reset_world();
$o = add_order( new WC_Order( 21, 75.0, 'GHS' ) );
$o->update_meta_data( '_agentmesh_payment_reference', 'amref_ret' );
$o->update_meta_data( '_agentmesh_payment_channel', 'card' );
$payments = new AgentMesh_Payments();
// Paystack verify → success → order advanced + 'paid'
_queue_http( [ 'status' => true, 'data' => [ 'status' => 'success', 'amount' => 7500, 'currency' => 'GHS', 'reference' => 'amref_ret' ] ] );
eq( 'paid', $payments->resolve_return( 'amref_ret' ), 'return verify success → paid' );
eq( 'processing', $o->get_status(), 'return landing advanced order to processing' );
// Unknown reference → graceful 'unknown' (no crash)
eq( 'unknown', $payments->resolve_return( 'nope_missing' ), 'unknown reference → unknown' );
// Empty reference → unknown
eq( 'unknown', $payments->resolve_return( '' ), 'empty reference → unknown' );
// Page renders with expected copy
$truthy = false !== strpos( $payments->render_return_page( 'paid' ), 'Payment received' );
eq( true, $truthy, 'paid return page renders confirmation copy' );

echo "\n";

// ─────────────────────────────────────────────────────────────────
// submit-otp
// ─────────────────────────────────────────────────────────────────
echo "POST /connector/payment/submit-otp:\n";

reset_world();
$o = add_order( new WC_Order( 30, 50.0, 'GHS' ) );
$o->update_meta_data( '_agentmesh_payment_reference', 'amref_otp2' );
$o->update_meta_data( '_agentmesh_payment_channel', 'mobile_money' );
_queue_http( [ 'status' => true, 'data' => [ 'status' => 'success', 'reference' => 'amref_otp2' ] ] );
$payments = new AgentMesh_Payments();
$resp = $payments->submit_otp( req( [ 'order_id' => 30, 'otp' => '123456' ] ) );
$data = $resp->get_data();
eq( 200, $resp->get_status(), 'submit-otp returns 200' );
eq( 'processing', $data['payment_status'], 'otp success → processing' );
$call = $GLOBALS['_http_calls'][0];
eq( 'https://api.paystack.co/charge/submit_otp', $call['url'], 'submit-otp hits /charge/submit_otp' );
$sent = json_decode( $call['args']['body'], true );
eq( '123456', $sent['otp'], 'otp forwarded to paystack' );
eq( 'amref_otp2', $sent['reference'], 'reference forwarded' );

// missing otp
reset_world();
add_order( new WC_Order( 31, 50.0, 'GHS' ) );
$payments = new AgentMesh_Payments();
$resp = $payments->submit_otp( req( [ 'order_id' => 31 ] ) );
eq( 400, $resp->get_status(), 'missing otp → 400' );

echo "\n";

// ─────────────────────────────────────────────────────────────────
// status — verify-on-poll advances order
// ─────────────────────────────────────────────────────────────────
echo "GET /connector/payment/status (verify-on-poll):\n";

reset_world();
$o = add_order( new WC_Order( 40, 50.0, 'GHS' ) );
$o->update_meta_data( '_agentmesh_payment_reference', 'amref_poll' );
$o->update_meta_data( '_agentmesh_payment_channel', 'mobile_money' );
_queue_http( [ 'status' => true, 'data' => [ 'status' => 'success', 'amount' => 5000, 'currency' => 'GHS' ] ] );
$payments = new AgentMesh_Payments();
$data = $payments->status( req( [ 'order_id' => 40 ] ) )->get_data();
eq( 'paid', $data['payment_status'], 'verify success → paid' );
eq( 'processing', wc_get_order( 40 )->get_status(), 'order advanced to processing on poll' );
ok( wc_get_order( 40 )->is_paid(), 'order marked paid' );

// pending stays awaiting
reset_world();
$o = add_order( new WC_Order( 41, 50.0, 'GHS' ) );
$o->update_meta_data( '_agentmesh_payment_reference', 'amref_pend' );
_queue_http( [ 'status' => true, 'data' => [ 'status' => 'pending', 'amount' => 5000, 'currency' => 'GHS' ] ] );
$payments = new AgentMesh_Payments();
$data = $payments->status( req( [ 'order_id' => 41 ] ) )->get_data();
eq( 'awaiting_user', $data['payment_status'], 'verify pending → awaiting_user' );
eq( 'pending', wc_get_order( 41 )->get_status(), 'order stays pending while unconfirmed' );

// already-paid short circuits (no HTTP)
reset_world();
$o = add_order( new WC_Order( 42, 50.0, 'GHS', 'processing' ) );
$o->update_meta_data( '_agentmesh_payment_reference', 'amref_done' );
$payments = new AgentMesh_Payments();
$data = $payments->status( req( [ 'order_id' => 42 ] ) )->get_data();
eq( 'paid', $data['payment_status'], 'processing order reports paid' );
eq( 0, count( $GLOBALS['_http_calls'] ), 'no verify call for already-paid order' );

// A not-yet-completed Paystack charge verifies as 'abandoned' — this is the
// awaiting-user window for BOTH mobile-money OTP and card redirect. Polling
// status during that window must NOT fail the order: abandoned = incomplete,
// not failed. (Used to map abandoned → failed and brick active payments.)
reset_world();
$o = add_order( new WC_Order( 43, 50.0, 'GHS' ) );
$o->update_meta_data( '_agentmesh_payment_reference', 'amref_abandon' );
_queue_http( [ 'status' => true, 'data' => [ 'status' => 'abandoned', 'amount' => 5000, 'currency' => 'GHS' ] ] );
$payments = new AgentMesh_Payments();
$data = $payments->status( req( [ 'order_id' => 43 ] ) )->get_data();
eq( 'awaiting_user', $data['payment_status'], 'verify abandoned → awaiting_user (incomplete, not failed)' );
eq( 'pending', wc_get_order( 43 )->get_status(), 'order NOT failed while payment incomplete' );

// outside the OTP window, a genuine verify failure still fails the order.
reset_world();
$o = add_order( new WC_Order( 44, 50.0, 'GHS' ) );
$o->update_meta_data( '_agentmesh_payment_reference', 'amref_fail' );
_queue_http( [ 'status' => true, 'data' => [ 'status' => 'failed', 'amount' => 5000, 'currency' => 'GHS' ] ] );
$payments = new AgentMesh_Payments();
$data = $payments->status( req( [ 'order_id' => 44 ] ) )->get_data();
eq( 'failed', $data['payment_status'], 'verify failed (no OTP window) → failed' );
eq( 'failed', wc_get_order( 44 )->get_status(), 'genuinely failed order is failed' );

echo "\n";

// ─────────────────────────────────────────────────────────────────
// webhook — signature verification + idempotency
// ─────────────────────────────────────────────────────────────────
echo "POST /webhooks/paystack:\n";

// valid signature → charge.success advances order
reset_world();
$o = add_order( new WC_Order( 50, 50.0, 'GHS' ) );
$o->update_meta_data( '_agentmesh_payment_reference', 'amref_wh' );
$payload = json_encode( [ 'event' => 'charge.success', 'data' => [ 'reference' => 'amref_wh', 'amount' => 5000, 'currency' => 'GHS' ] ] );
$sig = hash_hmac( 'sha512', $payload, 'sk_test_123' );
$payments = new AgentMesh_Payments();
$resp = $payments->handle_paystack_webhook( req( [], [ 'x-paystack-signature' => $sig ], $payload ) );
eq( 200, $resp->get_status(), 'valid webhook returns 200' );
eq( 'processing', wc_get_order( 50 )->get_status(), 'charge.success advances order to processing' );

// idempotency: a second identical webhook does not error / re-complete
$o2 = wc_get_order( 50 );
$notes_before = count( $o2->notes );
$resp = $payments->handle_paystack_webhook( req( [], [ 'x-paystack-signature' => $sig ], $payload ) );
eq( 200, $resp->get_status(), 'duplicate webhook still 200' );
ok( count( wc_get_order( 50 )->notes ) === $notes_before, 'duplicate webhook does not re-complete (idempotent)' );

// invalid signature → 401, order untouched
reset_world();
$o = add_order( new WC_Order( 51, 50.0, 'GHS' ) );
$o->update_meta_data( '_agentmesh_payment_reference', 'amref_bad' );
$payload = json_encode( [ 'event' => 'charge.success', 'data' => [ 'reference' => 'amref_bad', 'amount' => 5000, 'currency' => 'GHS' ] ] );
$payments = new AgentMesh_Payments();
$resp = $payments->handle_paystack_webhook( req( [], [ 'x-paystack-signature' => 'deadbeef' ], $payload ) );
eq( 401, $resp->get_status(), 'bad signature → 401' );
eq( 'pending', wc_get_order( 51 )->get_status(), 'order untouched on bad signature' );

// charge.failed marks failed
reset_world();
$o = add_order( new WC_Order( 52, 50.0, 'GHS' ) );
$o->update_meta_data( '_agentmesh_payment_reference', 'amref_fail' );
$payload = json_encode( [ 'event' => 'charge.failed', 'data' => [ 'reference' => 'amref_fail' ] ] );
$sig = hash_hmac( 'sha512', $payload, 'sk_test_123' );
$payments = new AgentMesh_Payments();
$resp = $payments->handle_paystack_webhook( req( [], [ 'x-paystack-signature' => $sig ], $payload ) );
eq( 'failed', wc_get_order( 52 )->get_status(), 'charge.failed marks order failed' );

// unknown reference → 200 ack, no crash
reset_world();
$payload = json_encode( [ 'event' => 'charge.success', 'data' => [ 'reference' => 'not_ours', 'amount' => 5000, 'currency' => 'GHS' ] ] );
$sig = hash_hmac( 'sha512', $payload, 'sk_test_123' );
$payments = new AgentMesh_Payments();
$resp = $payments->handle_paystack_webhook( req( [], [ 'x-paystack-signature' => $sig ], $payload ) );
eq( 200, $resp->get_status(), 'unknown reference acknowledged with 200' );

echo "\n";

// ─────────────────────────────────────────────────────────────────
// key reading — prefers WC-Paystack plugin options
// ─────────────────────────────────────────────────────────────────
echo "Paystack key resolution:\n";

reset_world();
$GLOBALS['_agentmesh_options']['woocommerce_paystack_settings'] = [
	'testmode'        => 'no',
	'live_secret_key' => 'sk_live_PLUGIN',
	'live_public_key' => 'pk_live_PLUGIN',
];
$prov = new AgentMesh_Paystack_Provider();
$keys = $prov->get_keys();
eq( 'live', $keys['mode'], 'plugin testmode=no → live mode' );
eq( 'sk_live_PLUGIN', $keys['secret_key'], 'reads live secret from WC-Paystack plugin options' );

reset_world();
unset( $GLOBALS['_agentmesh_options']['woocommerce_paystack_settings'] );
$prov = new AgentMesh_Paystack_Provider();
$keys = $prov->get_keys();
eq( 'test', $keys['mode'], 'falls back to agentmesh test mode' );
eq( 'sk_test_123', $keys['secret_key'], 'falls back to agentmesh_paystack_test_secret_key' );

echo "\n";

// ─────────────────────────────────────────────────────────────────
// normaliser PaymentSession shape
// ─────────────────────────────────────────────────────────────────
echo "Normaliser payment_session_to_amps:\n";

reset_world();
$o = new WC_Order( 60, 50.0, 'GHS' );
$session = AgentMesh_Normaliser::payment_session_to_amps( $o, [
	'reference'      => 'amref_n',
	'channel'        => 'card',
	'payment_status' => 'awaiting_user',
	'authorization_url' => 'https://checkout.paystack.com/z',
] );
eq( '60', $session['order_id'], 'session order_id is string' );
eq( 'card', $session['instruction']['channel'], 'card instruction channel' );
eq( 'redirect', $session['instruction']['action'], 'card instruction action' );
ok( ! isset( AgentMesh_Normaliser::payment_session_to_amps( $o, [ 'channel' => 'mobile_money', 'payment_status' => 'paid' ] )['instruction'] ), 'terminal paid has no instruction' );

echo "\n";

// ─────────────────────────────────────────────────────────────────
// Provider identity + enablement
// ─────────────────────────────────────────────────────────────────
echo "Provider identity + enablement:\n";

reset_world();
$GLOBALS['_agentmesh_options']['woocommerce_paystack_settings'] = [ 'testmode' => 'yes', 'test_secret_key' => 'sk_test_123' ];
$prov = new AgentMesh_Paystack_Provider();
eq( 'paystack', $prov->id(), 'paystack id()' );
eq( 'Paystack', $prov->label(), 'paystack label()' );
ok( $prov->is_configured(), 'paystack configured when keys present' );

reset_world(); // no keys — clear paystack fallback key so get_secret_key() returns ''
$GLOBALS['_agentmesh_options']['agentmesh_paystack_test_secret_key'] = '';
$prov = new AgentMesh_Paystack_Provider();
ok( ! $prov->is_configured(), 'paystack not configured without keys' );

// Case 1: configured + option present and 'yes' → enabled
reset_world();
$GLOBALS['_agentmesh_options']['agentmesh_payment_enable_paystack'] = 'yes';
$prov = new AgentMesh_Paystack_Provider();
ok( $prov->is_enabled(), 'paystack enabled when configured + option yes' );

// Case 2: configured but option explicitly 'no' → not enabled
reset_world();
$GLOBALS['_agentmesh_options']['agentmesh_payment_enable_paystack'] = 'no';
$prov = new AgentMesh_Paystack_Provider();
ok( ! $prov->is_enabled(), 'paystack not enabled when option is no' );

// Case 3: not configured → not enabled regardless of option
reset_world();
$GLOBALS['_agentmesh_options']['agentmesh_paystack_test_secret_key'] = '';
$GLOBALS['_agentmesh_options']['agentmesh_payment_enable_paystack'] = 'yes';
$prov = new AgentMesh_Paystack_Provider();
ok( ! $prov->is_enabled(), 'paystack not enabled without keys even if option is yes' );

echo "\n";

// ─────────────────────────────────────────────────────────────────
// Stripe provider
// ─────────────────────────────────────────────────────────────────
echo "Stripe provider:\n";

reset_world();
$GLOBALS['_agentmesh_options']['agentmesh_stripe_mode'] = 'test';
$GLOBALS['_agentmesh_options']['agentmesh_stripe_test_secret_key'] = 'sk_test_STRIPE';
$GLOBALS['_agentmesh_options']['agentmesh_payment_enable_stripe'] = 'yes';

$stripe = new AgentMesh_Stripe_Provider();
eq( 'stripe', $stripe->id(), 'stripe id()' );
ok( $stripe->is_configured(), 'stripe configured when secret present' );
ok( $stripe->is_enabled(), 'stripe enabled when configured + toggled' );

// initiate card → Checkout Session url
$o = new WC_Order( 70, 80.0, 'USD' );
$GLOBALS['_orders'][70] = $o;
_queue_http( [ 'id' => 'cs_test_abc', 'url' => 'https://checkout.stripe.com/c/pay/cs_test_abc' ] );
$session = $stripe->initiate( $o, 'card', [] );
eq( 'awaiting_user', $session['payment_status'], 'stripe initiate awaiting_user' );
eq( 'https://checkout.stripe.com/c/pay/cs_test_abc', $session['instruction']['authorization_url'], 'stripe authorization_url is session url' );
$last = end( $GLOBALS['_http_calls'] );
ok( str_contains( $last['url'], '/v1/checkout/sessions' ), 'stripe calls checkout sessions endpoint' );

// mobile_money unsupported
reset_world();
$GLOBALS['_agentmesh_options']['agentmesh_stripe_test_secret_key'] = 'sk_test_STRIPE';
$stripe = new AgentMesh_Stripe_Provider();
$o = new WC_Order( 71, 80.0, 'USD' );
$fail = $stripe->initiate( $o, 'mobile_money', [ 'phone' => '0551234567', 'provider' => 'mtn' ] );
eq( 'failed', $fail['payment_status'], 'stripe rejects mobile_money' );

// submit_otp unsupported
$fotp = $stripe->submit_otp( $o, 'cs_test_abc', '1234' );
eq( 'failed', $fotp['payment_status'], 'stripe rejects submit_otp' );

// verify maps complete → success
reset_world();
$GLOBALS['_agentmesh_options']['agentmesh_stripe_test_secret_key'] = 'sk_test_STRIPE';
$stripe = new AgentMesh_Stripe_Provider();
_queue_http( [ 'id' => 'cs_test_abc', 'status' => 'complete', 'payment_status' => 'paid', 'amount_total' => 8000, 'currency' => 'usd' ] );
$v = $stripe->verify( 'cs_test_abc' );
eq( 'success', $v['status'], 'stripe verify complete → success' );
eq( 80.0, $v['amount'], 'stripe verify amount from subunits' );

// verify maps expired → failed
reset_world();
$GLOBALS['_agentmesh_options']['agentmesh_stripe_test_secret_key'] = 'sk_test_STRIPE';
$stripe = new AgentMesh_Stripe_Provider();
_queue_http( [ 'id' => 'cs_test_abc', 'status' => 'expired', 'payment_status' => 'unpaid', 'amount_total' => 8000, 'currency' => 'usd' ] );
$v = $stripe->verify( 'cs_test_abc' );
eq( 'failed', $v['status'], 'stripe verify expired → failed' );

// verify maps open/unpaid → pending
reset_world();
$GLOBALS['_agentmesh_options']['agentmesh_stripe_test_secret_key'] = 'sk_test_STRIPE';
$stripe = new AgentMesh_Stripe_Provider();
_queue_http( [ 'id' => 'cs_test_abc', 'status' => 'open', 'payment_status' => 'unpaid', 'amount_total' => 8000, 'currency' => 'usd' ] );
$v = $stripe->verify( 'cs_test_abc' );
eq( 'pending', $v['status'], 'stripe verify open → pending' );

// webhook signature: invalid when no secret/sig
reset_world();
$stripe = new AgentMesh_Stripe_Provider();
$req = new WP_REST_Request();
$req->set_body( '{"type":"checkout.session.completed"}' );
$parsed = $stripe->parse_webhook( $req );
ok( ! $parsed['valid'], 'stripe webhook invalid without signature' );

// webhook valid with correct HMAC signature
reset_world();
$GLOBALS['_agentmesh_options']['agentmesh_stripe_webhook_secret'] = 'whsec_test';
$stripe = new AgentMesh_Stripe_Provider();
$wbody = '{"type":"checkout.session.completed","data":{"object":{"id":"cs_x","amount_total":5000,"currency":"usd"}}}';
$wts   = (string) time();
$wsig  = 't=' . $wts . ',v1=' . hash_hmac( 'sha256', $wts . '.' . $wbody, 'whsec_test' );
$req = new WP_REST_Request();
$req->set_header( 'stripe-signature', $wsig );
$req->set_body( $wbody );
$parsed = $stripe->parse_webhook( $req );
ok( $parsed['valid'], 'stripe webhook valid with correct HMAC' );
eq( 'checkout.session.completed', $parsed['event'], 'stripe webhook event parsed' );
eq( 'cs_x', $parsed['reference'], 'stripe webhook reference parsed' );

echo "\n";

// ─────────────────────────────────────────────────────────────────
// Gateway registry
// ─────────────────────────────────────────────────────────────────
echo "Gateway registry:\n";

reset_world();
$GLOBALS['_agentmesh_options']['woocommerce_paystack_settings'] = [ 'testmode' => 'yes', 'test_secret_key' => 'sk_test_123' ];
$GLOBALS['_agentmesh_options']['agentmesh_stripe_test_secret_key'] = 'sk_test_STRIPE';
$GLOBALS['_agentmesh_options']['agentmesh_payment_enable_stripe'] = 'yes';

$reg = new AgentMesh_Payment_Gateways();
$ids = array_map( fn( $p ) => $p->id(), $reg->enabled() );
ok( in_array( 'paystack', $ids, true ), 'registry enables configured paystack' );
ok( in_array( 'stripe', $ids, true ), 'registry enables configured+toggled stripe' );
eq( 'stripe', $reg->get( 'stripe' )->id(), 'registry get(stripe)' );
eq( 'paystack', $reg->default()->id(), 'registry default is paystack (first registered)' );

reset_world(); // only paystack fallback keys; stripe not configured
$reg = new AgentMesh_Payment_Gateways();
$ids2 = array_map( fn( $p ) => $p->id(), $reg->enabled() );
ok( ! in_array( 'stripe', $ids2, true ), 'stripe not enabled when not configured' );
ok( null === $reg->get( 'stripe' ), 'registry get(stripe) null when disabled' );

echo "\n";

// ─────────────────────────────────────────────────────────────────
// Aggregated methods + gateway routing
// ─────────────────────────────────────────────────────────────────
echo "Aggregated methods + gateway routing:\n";

reset_world();
$GLOBALS['_agentmesh_options']['woocommerce_paystack_settings'] = [ 'testmode' => 'yes', 'test_secret_key' => 'sk_test_123' ];
$GLOBALS['_agentmesh_options']['agentmesh_stripe_test_secret_key'] = 'sk_test_STRIPE';
$GLOBALS['_agentmesh_options']['agentmesh_payment_enable_stripe'] = 'yes';

$o = new WC_Order( 80, 50.0, 'GHS' );
$GLOBALS['_orders'][80] = $o;
$payments = new AgentMesh_Payments();
$req = new WP_REST_Request();
$req->set_param( 'order_id', 80 );
$resp = $payments->get_methods( $req );
$data = $resp->get_data();
ok( isset( $data['gateways'] ), 'methods returns gateways[]' );
$gw_ids = array_map( fn( $g ) => $g['id'], $data['gateways'] );
ok( in_array( 'paystack', $gw_ids, true ) && in_array( 'stripe', $gw_ids, true ), 'both gateways listed' );
ok( isset( $data['methods'] ), 'legacy flat methods retained' );

// initiate routes to stripe when gateway=stripe
$req2 = new WP_REST_Request();
$req2->set_param( 'order_id', 80 );
$req2->set_param( 'gateway', 'stripe' );
$req2->set_param( 'channel', 'card' );
_queue_http( [ 'id' => 'cs_test_xyz', 'url' => 'https://checkout.stripe.com/c/pay/cs_test_xyz' ] );
$ir = $payments->initiate( $req2 );
$idata = $ir->get_data();
eq( 'awaiting_user', $idata['payment_status'], 'stripe initiate via registry' );
$last = end( $GLOBALS['_http_calls'] );
ok( str_contains( $last['url'], 'api.stripe.com' ), 'routed to stripe API' );

echo "\n";

// ─────────────────────────────────────────────────────────────────
// Stripe webhook handler
// ─────────────────────────────────────────────────────────────────
echo "Stripe webhook handler:\n";

// invalid signature → 401
reset_world();
$GLOBALS['_agentmesh_options']['agentmesh_stripe_webhook_secret'] = 'whsec_test';
$payments = new AgentMesh_Payments();
$req = new WP_REST_Request();
$req->set_header( 'stripe-signature', 't=1,v1=deadbeef' );
$req->set_body( '{"type":"checkout.session.completed","data":{"object":{"id":"cs_w1"}}}' );
$resp = $payments->handle_stripe_webhook( $req );
eq( 401, $resp->get_status(), 'stripe webhook bad signature → 401' );

// valid completed webhook advances a matching order to paid + stamps gateway
reset_world();
$GLOBALS['_agentmesh_options']['agentmesh_stripe_webhook_secret'] = 'whsec_test';
$GLOBALS['_agentmesh_options']['agentmesh_stripe_test_secret_key'] = 'sk_test_STRIPE';
$GLOBALS['_agentmesh_options']['agentmesh_payment_enable_stripe'] = 'yes';
$o = new WC_Order( 90, 50.0, 'USD' );
$o->update_meta_data( '_agentmesh_payment_reference', 'cs_w2' );
$o->update_meta_data( '_agentmesh_payment_gateway', 'stripe' );
$GLOBALS['_orders'][90] = $o;
$wbody = '{"type":"checkout.session.completed","data":{"object":{"id":"cs_w2","amount_total":5000,"currency":"usd"}}}';
$wts   = (string) time();
$wsig  = 't=' . $wts . ',v1=' . hash_hmac( 'sha256', $wts . '.' . $wbody, 'whsec_test' );
$req = new WP_REST_Request();
$req->set_header( 'stripe-signature', $wsig );
$req->set_body( $wbody );
$resp = $payments->handle_stripe_webhook( $req );
eq( 200, $resp->get_status(), 'stripe webhook completed → 200' );
ok( $o->is_paid(), 'stripe webhook marked order paid' );

// unknown order → 200 ack
reset_world();
$GLOBALS['_agentmesh_options']['agentmesh_stripe_webhook_secret'] = 'whsec_test';
$payments = new AgentMesh_Payments();
$wbody = '{"type":"checkout.session.completed","data":{"object":{"id":"cs_nomatch","amount_total":100,"currency":"usd"}}}';
$wts   = (string) time();
$wsig  = 't=' . $wts . ',v1=' . hash_hmac( 'sha256', $wts . '.' . $wbody, 'whsec_test' );
$req = new WP_REST_Request();
$req->set_header( 'stripe-signature', $wsig );
$req->set_body( $wbody );
$resp = $payments->handle_stripe_webhook( $req );
eq( 200, $resp->get_status(), 'stripe webhook unknown order → 200 ack' );

echo "\n";

// ─────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────
echo "================================\n";
echo "Test Results:\n";
echo "================================\n";
foreach ( $details as $d ) { echo "$d\n"; }
echo "\nTotal: " . ( $tests_passed + $tests_failed ) . " tests\n";
echo "Passed: $tests_passed\n";
echo "Failed: $tests_failed\n";
echo "================================\n";
if ( $tests_failed > 0 ) { exit( 1 ); }
echo "\n✓ All payment tests passed!\n";
exit( 0 );
