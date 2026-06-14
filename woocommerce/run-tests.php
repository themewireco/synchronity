#!/usr/bin/env php
<?php
/**
 * Manual test runner for Schema Injector
 * (When PHPUnit/Composer are not available)
 */

error_reporting( E_ALL );
ini_set( 'display_errors', '1' );

define( 'ABSPATH', __DIR__ . '/' );
define( 'AGENTMESH_VERSION', '0.1.0' );
define( 'AGENTMESH_PLUGIN_DIR', __DIR__ . '/' );
define( 'AGENTMESH_REST_NAMESPACE', 'agentmesh/v1' );

// ─────────────────────────────────────────────────────────────────
// Minimal WordPress stubs
// ─────────────────────────────────────────────────────────────────

$_WORDPRESS_STUBS = [];

function get_option( $key, $default = false ) {
	global $_agentmesh_options;
	return $_agentmesh_options[ $key ] ?? $default;
}

function is_admin(): bool { 
	return defined( 'WP_ADMIN' ) && WP_ADMIN; 
}

$GLOBALS['_wp_actions'] = [];
function add_action( $hook, $callback, $priority = 10, $accepted_args = 1 ): void {
	if ( ! isset( $GLOBALS['_wp_actions'][ $hook ] ) ) {
		$GLOBALS['_wp_actions'][ $hook ] = [];
	}
	$GLOBALS['_wp_actions'][ $hook ][] = $callback;
}

$GLOBALS['_wp_cache'] = [];
function wp_cache_get( $key ) {
	return $GLOBALS['_wp_cache'][ $key ] ?? false;
}

function wp_cache_set( $key, $value, $group = '', $expire = 0 ): bool {
	$GLOBALS['_wp_cache'][ $key ] = $value;
	return true;
}

function wp_cache_delete( $key ): bool {
	unset( $GLOBALS['_wp_cache'][ $key ] );
	return true;
}

function wp_remote_get( $url, $args = [] ) {
	return new WP_Error( 'not_mocked', 'wp_remote_get not mocked' );
}

function wp_remote_retrieve_response_code( $response ): int {
	return $response['response']['code'] ?? 500;
}

function wp_remote_retrieve_body( $response ): string {
	return $response['body'] ?? '';
}

function esc_attr( $text ): string {
	return htmlspecialchars( $text, ENT_QUOTES, 'UTF-8' );
}

function do_action( $hook, ...$args ): void {}

function wp_unslash( $value ) {
	return stripslashes_deep( $value );
}

function stripslashes_deep( $value ) {
	if ( is_array( $value ) ) {
		return array_map( 'stripslashes_deep', $value );
	}
	return is_string( $value ) ? stripslashes( $value ) : $value;
}

function sanitize_text_field( $str ): string {
	return trim( strip_tags( $str ) );
}

class WP_Error {
	public function __construct(
		public string $code = '',
		public string $message = '',
		public mixed $data = null
	) {}
	public function get_error_message(): string { return $this->message; }
}

// ─────────────────────────────────────────────────────────────────
// Load IP validator and schema injector
// ─────────────────────────────────────────────────────────────────

require_once AGENTMESH_PLUGIN_DIR . 'includes/class-ip-validator.php';
require_once AGENTMESH_PLUGIN_DIR . 'includes/class-schema-injector.php';

// ─────────────────────────────────────────────────────────────────
// Test Suite
// ─────────────────────────────────────────────────────────────────

$tests_passed = 0;
$tests_failed = 0;
$test_details = [];

function assert_true( $condition, $test_name ) {
	global $tests_passed, $tests_failed, $test_details;
	if ( $condition ) {
		$tests_passed++;
		$test_details[] = "✓ $test_name";
	} else {
		$tests_failed++;
		$test_details[] = "✗ $test_name";
	}
}

function assert_false( $condition, $test_name ) {
	assert_true( ! $condition, $test_name );
}

function assert_equals( $expected, $actual, $test_name ) {
	global $tests_passed, $tests_failed, $test_details;
	if ( $expected === $actual ) {
		$tests_passed++;
		$test_details[] = "✓ $test_name";
	} else {
		$tests_failed++;
		$test_details[] = "✗ $test_name (expected: " . var_export( $expected, true ) . ", got: " . var_export( $actual, true ) . ")";
	}
}

function assert_contains( $haystack, $needle, $test_name ) {
	assert_true( strpos( $haystack, $needle ) !== false, $test_name );
}

function assert_null( $value, $test_name ) {
	assert_true( $value === null || $value === false, $test_name );
}

function assert_not_null( $value, $test_name ) {
	assert_true( $value !== null, $test_name );
}

function setup_test() {
	$GLOBALS['_wp_cache'] = [];
	$GLOBALS['_agentmesh_options'] = [
		'agentmesh_schema_injection_enabled' => true,
		'agentmesh_gateway_url'              => 'http://localhost:3000',
	];
	unset( $_SERVER['HTTP_USER_AGENT'], $_SERVER['REMOTE_ADDR'], $_SERVER['HTTP_CLIENT_IP'], $_SERVER['HTTP_X_FORWARDED_FOR'] );
}

// ─────────────────────────────────────────────────────────────────
// Run tests
// ─────────────────────────────────────────────────────────────────

echo "Running Schema Injector Tests...\n";
echo "================================\n\n";

// IP Detection Tests (IP-Only, No User-Agent Check)
echo "Testing LLM IP Detection (IP-Only):\n";

setup_test();
$_SERVER['REMOTE_ADDR'] = '54.191.123.45';
assert_true( AgentMesh_IP_Validator::is_llm_request(), 'Detects Claude IP' );

setup_test();
$_SERVER['REMOTE_ADDR'] = '34.208.100.50';
assert_true( AgentMesh_IP_Validator::is_llm_request(), 'Detects ChatGPT IP' );

setup_test();
$_SERVER['REMOTE_ADDR'] = '206.189.50.100';
assert_true( AgentMesh_IP_Validator::is_llm_request(), 'Detects Perplexity IP' );

setup_test();
$_SERVER['REMOTE_ADDR'] = '34.64.200.50';
assert_true( AgentMesh_IP_Validator::is_llm_request(), 'Detects Gemini IP' );

setup_test();
$_SERVER['REMOTE_ADDR'] = '192.168.1.1';
assert_false( AgentMesh_IP_Validator::is_llm_request(), 'Rejects private IP' );

setup_test();
$_SERVER['REMOTE_ADDR'] = '1.2.3.4';
assert_false( AgentMesh_IP_Validator::is_llm_request(), 'Rejects random IP' );

setup_test();
$_SERVER['REMOTE_ADDR'] = '54.191.123.45';
assert_equals( 'claude', AgentMesh_IP_Validator::get_detected_llm(), 'Detects Claude provider' );

setup_test();
$_SERVER['REMOTE_ADDR'] = '1.2.3.4';
assert_null( AgentMesh_IP_Validator::get_detected_llm(), 'Returns null for unknown IP' );

echo "\n";

// Schema Validation Tests
echo "Testing Schema Validation:\n";
$injector = new AgentMesh_Schema_Injector();
$reflection = new ReflectionClass( $injector );
$validate_schema = $reflection->getMethod( 'is_valid_schema' );
$validate_schema->setAccessible( true );

$valid_schema = [ 'amps' => true, 'version' => '1.0', 'signature' => 'sig_abc123' ];
assert_true( $validate_schema->invoke( $injector, $valid_schema ), 'Validates valid schema' );

$missing_amps = [ 'version' => '1.0', 'signature' => 'sig_abc123' ];
assert_false( $validate_schema->invoke( $injector, $missing_amps ), 'Rejects schema missing amps' );

$missing_version = [ 'amps' => true, 'signature' => 'sig_abc123' ];
assert_false( $validate_schema->invoke( $injector, $missing_version ), 'Rejects schema missing version' );

$missing_sig = [ 'amps' => true, 'version' => '1.0' ];
assert_false( $validate_schema->invoke( $injector, $missing_sig ), 'Rejects schema missing signature' );

echo "\n";

// Schema Rendering Tests
echo "Testing Schema Rendering:\n";
$render_schema = $reflection->getMethod( 'render_schema_tag' );
$render_schema->setAccessible( true );

$schema = [ 'amps' => true, 'version' => '1.0', 'signature' => 'sig_abc123' ];
$output = $render_schema->invoke( $injector, $schema );
assert_contains( $output, '<script type="application/ld+json"', 'Renders script tag' );
assert_contains( $output, 'id="agentmesh-amps-schema"', 'Includes schema ID' );
assert_contains( $output, '</script>', 'Includes closing tag' );
assert_contains( $output, '"amps":true', 'Contains schema data' );

echo "\n";

// Client IP Detection Tests
echo "Testing Client IP Detection:\n";
$get_ip = $reflection->getMethod( 'get_client_ip' );
$get_ip->setAccessible( true );

setup_test();
$_SERVER['REMOTE_ADDR'] = '192.168.1.1';
assert_equals( '192.168.1.1', $get_ip->invoke( $injector ), 'Gets REMOTE_ADDR' );

setup_test();
$_SERVER['HTTP_CLIENT_IP'] = '10.0.0.1';
$_SERVER['REMOTE_ADDR'] = '192.168.1.1';
assert_equals( '10.0.0.1', $get_ip->invoke( $injector ), 'Gets CLIENT_IP header' );

setup_test();
$_SERVER['HTTP_X_FORWARDED_FOR'] = '203.0.113.1, 198.51.100.1';
unset( $_SERVER['HTTP_CLIENT_IP'] );
assert_equals( '203.0.113.1', $get_ip->invoke( $injector ), 'Gets first IP from X-Forwarded-For' );

setup_test();
$_SERVER['REMOTE_ADDR'] = 'invalid-ip';
assert_equals( '0.0.0.0', $get_ip->invoke( $injector ), 'Defaults to 0.0.0.0 for invalid IP' );

echo "\n";

// Rate Limiting Tests
echo "Testing Rate Limiting:\n";
$check_rate_limit = $reflection->getMethod( 'check_rate_limit' );
$check_rate_limit->setAccessible( true );
$record_rate_limit = $reflection->getMethod( 'record_rate_limit' );
$record_rate_limit->setAccessible( true );

setup_test();
$_SERVER['REMOTE_ADDR'] = '192.168.1.3';
$GLOBALS['_wp_cache'] = [];
assert_true( $check_rate_limit->invoke( $injector ), 'Allows first request' );

setup_test();
$_SERVER['REMOTE_ADDR'] = '192.168.1.4';
assert_true( $check_rate_limit->invoke( $injector ), 'First request to new IP passes' );
$record_rate_limit->invoke( $injector );
assert_false( $check_rate_limit->invoke( $injector ), 'Blocks second request from same IP' );

echo "\n";

// Cache Tests
echo "Testing Caching:\n";
setup_test();
$schema = [ 'amps' => true, 'version' => '1.0', 'signature' => 'sig_abc123' ];
wp_cache_set( 'agentmesh_schema_cache', $schema );
assert_not_null( wp_cache_get( 'agentmesh_schema_cache' ), 'Schema cached' );

$injector->clear_cache();
assert_null( wp_cache_get( 'agentmesh_schema_cache' ), 'Cache cleared' );

echo "\n";

// Gateway URL Tests
echo "Testing Gateway Configuration:\n";
setup_test();
$GLOBALS['_agentmesh_options']['agentmesh_gateway_url'] = '';
$fetch_gateway = $reflection->getMethod( 'fetch_schema_from_gateway' );
$fetch_gateway->setAccessible( true );
assert_null( $fetch_gateway->invoke( $injector ), 'Returns null for empty gateway URL' );

echo "\n";

// ─────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────

echo "================================\n";
echo "Test Results:\n";
echo "================================\n";

foreach ( $test_details as $detail ) {
	echo "$detail\n";
}

echo "\n";
echo "Total: " . ( $tests_passed + $tests_failed ) . " tests\n";
echo "Passed: $tests_passed\n";
echo "Failed: $tests_failed\n";
echo "================================\n";

if ( $tests_failed > 0 ) {
	exit( 1 );
}

echo "\n✓ All tests passed!\n";
exit( 0 );
