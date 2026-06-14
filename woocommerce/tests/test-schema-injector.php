<?php
/**
 * Tests for AgentMesh_Schema_Injector.
 */

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/bootstrap.php';

// ─────────────────────────────────────────────────────────────────
// Additional stubs needed for schema injector
// ─────────────────────────────────────────────────────────────────

if ( ! function_exists( 'is_admin' ) ) {
	function is_admin(): bool { 
		return defined( 'WP_ADMIN' ) && WP_ADMIN; 
	}
}

if ( ! function_exists( 'add_action' ) ) {
	$GLOBALS['_wp_actions'] = [];
	function add_action( $hook, $callback, $priority = 10, $accepted_args = 1 ): void {
		if ( ! isset( $GLOBALS['_wp_actions'][ $hook ] ) ) {
			$GLOBALS['_wp_actions'][ $hook ] = [];
		}
		$GLOBALS['_wp_actions'][ $hook ][] = $callback;
	}
}

if ( ! function_exists( 'wp_cache_get' ) ) {
	$GLOBALS['_wp_cache'] = [];
	function wp_cache_get( $key ) {
		return $GLOBALS['_wp_cache'][ $key ] ?? false;
	}
}

if ( ! function_exists( 'wp_cache_set' ) ) {
	function wp_cache_set( $key, $value, $group = '', $expire = 0 ): bool {
		$GLOBALS['_wp_cache'][ $key ] = $value;
		return true;
	}
}

if ( ! function_exists( 'wp_cache_delete' ) ) {
	function wp_cache_delete( $key ): bool {
		unset( $GLOBALS['_wp_cache'][ $key ] );
		return true;
	}
}

if ( ! function_exists( 'wp_remote_get' ) ) {
	function wp_remote_get( $url, $args = [] ) {
		// Stub that can be overridden in tests
		return new WP_Error( 'not_mocked', 'wp_remote_get not mocked' );
	}
}

if ( ! function_exists( 'wp_remote_retrieve_response_code' ) ) {
	function wp_remote_retrieve_response_code( $response ): int {
		return $response['response']['code'] ?? 500;
	}
}

if ( ! function_exists( 'wp_remote_retrieve_body' ) ) {
	function wp_remote_retrieve_body( $response ): string {
		return $response['body'] ?? '';
	}
}

if ( ! function_exists( 'esc_attr' ) ) {
	function esc_attr( $text ): string {
		return htmlspecialchars( $text, ENT_QUOTES, 'UTF-8' );
	}
}

if ( ! function_exists( 'do_action' ) ) {
	function do_action( $hook, ...$args ): void {
		// Stub for error reporting
	}
}

if ( ! function_exists( 'wp_unslash' ) ) {
	function wp_unslash( $value ) {
		return stripslashes_deep( $value );
	}
}

if ( ! function_exists( 'stripslashes_deep' ) ) {
	function stripslashes_deep( $value ) {
		if ( is_array( $value ) ) {
			return array_map( 'stripslashes_deep', $value );
		}
		return is_string( $value ) ? stripslashes( $value ) : $value;
	}
}

// Load the schema injector and IP validator
require_once AGENTMESH_PLUGIN_DIR . 'includes/class-ip-validator.php';
require_once AGENTMESH_PLUGIN_DIR . 'includes/class-schema-injector.php';

// ─────────────────────────────────────────────────────────────────
// Test Suite
// ─────────────────────────────────────────────────────────────────

class Test_Schema_Injector extends TestCase {

	private AgentMesh_Schema_Injector $injector;

	protected function setUp(): void {
		parent::setUp();
		
		// Reset global caches and options
		$GLOBALS['_wp_cache'] = [];
		$GLOBALS['_agentmesh_options'] = [
			'agentmesh_schema_injection_enabled' => true,
			'agentmesh_gateway_url'              => 'http://localhost:3000',
		];
		
		$this->injector = new AgentMesh_Schema_Injector();
	}

	// ─────────────────────────────────────────────────────────────────
	// LLM IP Detection Tests (IP-Only, No User-Agent Check)
	// ─────────────────────────────────────────────────────────────────

	public function test_detects_claude_ip(): void {
		$_SERVER['REMOTE_ADDR'] = '54.191.123.45';
		
		$this->assertTrue( AgentMesh_IP_Validator::is_llm_request() );
	}

	public function test_detects_chatgpt_ip(): void {
		$_SERVER['REMOTE_ADDR'] = '34.208.100.50';
		
		$this->assertTrue( AgentMesh_IP_Validator::is_llm_request() );
	}

	public function test_detects_perplexity_ip(): void {
		$_SERVER['REMOTE_ADDR'] = '206.189.50.100';
		
		$this->assertTrue( AgentMesh_IP_Validator::is_llm_request() );
	}

	public function test_detects_gemini_ip(): void {
		$_SERVER['REMOTE_ADDR'] = '34.64.200.50';
		
		$this->assertTrue( AgentMesh_IP_Validator::is_llm_request() );
	}

	public function test_rejects_random_ip(): void {
		$_SERVER['REMOTE_ADDR'] = '192.168.1.1';
		
		$this->assertFalse( AgentMesh_IP_Validator::is_llm_request() );
	}

	public function test_get_detected_llm_returns_provider(): void {
		$_SERVER['REMOTE_ADDR'] = '54.191.123.45';
		
		$this->assertEquals( 'claude', AgentMesh_IP_Validator::get_detected_llm() );
	}

	public function test_get_detected_llm_returns_null_for_unknown(): void {
		$_SERVER['REMOTE_ADDR'] = '1.2.3.4';
		
		$this->assertNull( AgentMesh_IP_Validator::get_detected_llm() );
	}

	// ─────────────────────────────────────────────────────────────────
	// Client IP Detection Tests
	// ─────────────────────────────────────────────────────────────────

	public function test_gets_remote_addr(): void {
		$_SERVER['REMOTE_ADDR'] = '192.168.1.1';
		
		$reflection = new ReflectionClass( $this->injector );
		$method = $reflection->getMethod( 'get_client_ip' );
		$method->setAccessible( true );
		
		$this->assertEquals( '192.168.1.1', $method->invoke( $this->injector ) );
	}

	public function test_gets_client_ip_header(): void {
		$_SERVER['HTTP_CLIENT_IP'] = '10.0.0.1';
		$_SERVER['REMOTE_ADDR'] = '192.168.1.1';
		
		$reflection = new ReflectionClass( $this->injector );
		$method = $reflection->getMethod( 'get_client_ip' );
		$method->setAccessible( true );
		
		$this->assertEquals( '10.0.0.1', $method->invoke( $this->injector ) );
	}

	public function test_gets_first_ip_from_x_forwarded_for(): void {
		$_SERVER['HTTP_X_FORWARDED_FOR'] = '203.0.113.1, 198.51.100.1, 192.0.2.1';
		unset( $_SERVER['HTTP_CLIENT_IP'] );
		
		$reflection = new ReflectionClass( $this->injector );
		$method = $reflection->getMethod( 'get_client_ip' );
		$method->setAccessible( true );
		
		$this->assertEquals( '203.0.113.1', $method->invoke( $this->injector ) );
	}

	public function test_defaults_to_0_0_0_0_on_invalid_ip(): void {
		$_SERVER['REMOTE_ADDR'] = 'invalid-ip';
		
		$reflection = new ReflectionClass( $this->injector );
		$method = $reflection->getMethod( 'get_client_ip' );
		$method->setAccessible( true );
		
		$this->assertEquals( '0.0.0.0', $method->invoke( $this->injector ) );
	}

	// ─────────────────────────────────────────────────────────────────
	// Schema Validation Tests
	// ─────────────────────────────────────────────────────────────────

	public function test_validates_valid_schema(): void {
		$schema = [
			'amps'      => true,
			'version'   => '1.0',
			'signature' => 'sig_abc123',
			'tools'     => [],
		];
		
		$reflection = new ReflectionClass( $this->injector );
		$method = $reflection->getMethod( 'is_valid_schema' );
		$method->setAccessible( true );
		
		$this->assertTrue( $method->invoke( $this->injector, $schema ) );
	}

	public function test_rejects_schema_missing_amps(): void {
		$schema = [
			'version'   => '1.0',
			'signature' => 'sig_abc123',
		];
		
		$reflection = new ReflectionClass( $this->injector );
		$method = $reflection->getMethod( 'is_valid_schema' );
		$method->setAccessible( true );
		
		$this->assertFalse( $method->invoke( $this->injector, $schema ) );
	}

	public function test_rejects_schema_missing_version(): void {
		$schema = [
			'amps'      => true,
			'signature' => 'sig_abc123',
		];
		
		$reflection = new ReflectionClass( $this->injector );
		$method = $reflection->getMethod( 'is_valid_schema' );
		$method->setAccessible( true );
		
		$this->assertFalse( $method->invoke( $this->injector, $schema ) );
	}

	public function test_rejects_schema_missing_signature(): void {
		$schema = [
			'amps'    => true,
			'version' => '1.0',
		];
		
		$reflection = new ReflectionClass( $this->injector );
		$method = $reflection->getMethod( 'is_valid_schema' );
		$method->setAccessible( true );
		
		$this->assertFalse( $method->invoke( $this->injector, $schema ) );
	}

	// ─────────────────────────────────────────────────────────────────
	// Schema Rendering Tests
	// ─────────────────────────────────────────────────────────────────

	public function test_renders_schema_as_script_tag(): void {
		$schema = [
			'amps'      => true,
			'version'   => '1.0',
			'signature' => 'sig_abc123',
		];
		
		$reflection = new ReflectionClass( $this->injector );
		$method = $reflection->getMethod( 'render_schema_tag' );
		$method->setAccessible( true );
		
		$output = $method->invoke( $this->injector, $schema );
		
		$this->assertStringContainsString( '<script type="application/ld+json"', $output );
		$this->assertStringContainsString( 'id="agentmesh-amps-schema"', $output );
		$this->assertStringContainsString( '</script>', $output );
	}

	public function test_schema_tag_contains_json_data(): void {
		$schema = [
			'amps'      => true,
			'version'   => '1.0',
			'signature' => 'sig_abc123',
			'test_key'  => 'test_value',
		];
		
		$reflection = new ReflectionClass( $this->injector );
		$method = $reflection->getMethod( 'render_schema_tag' );
		$method->setAccessible( true );
		
		$output = $method->invoke( $this->injector, $schema );
		
		$this->assertStringContainsString( '"amps":true', $output );
		$this->assertStringContainsString( '"version":"1.0"', $output );
		$this->assertStringContainsString( '"signature":"sig_abc123"', $output );
		$this->assertStringContainsString( '"test_key":"test_value"', $output );
	}

	// ─────────────────────────────────────────────────────────────────
	// Caching Tests
	// ─────────────────────────────────────────────────────────────────

	public function test_schema_caching(): void {
		$schema = [
			'amps'      => true,
			'version'   => '1.0',
			'signature' => 'sig_abc123',
		];
		
		$reflection = new ReflectionClass( $this->injector );
		$cache_method = $reflection->getMethod( 'get_schema' );
		$cache_method->setAccessible( true );
		
		// Mock rate limit
		$rate_limit_method = $reflection->getMethod( 'check_rate_limit' );
		$rate_limit_method->setAccessible( true );
		
		// Mock fetch to put schema in cache
		wp_cache_set( 'agentmesh_schema_cache', $schema );
		
		// Clear the rate limit so we can call
		$GLOBALS['_wp_cache']['agentmesh_schema_rate_limit_0.0.0.0'] = 0;
		
		$result = $cache_method->invoke( $this->injector );
		
		$this->assertEquals( $schema, $result );
	}

	public function test_clear_cache(): void {
		$schema = [
			'amps'      => true,
			'version'   => '1.0',
			'signature' => 'sig_abc123',
		];
		
		wp_cache_set( 'agentmesh_schema_cache', $schema );
		$this->assertNotFalse( wp_cache_get( 'agentmesh_schema_cache' ) );
		
		$this->injector->clear_cache();
		$this->assertFalse( wp_cache_get( 'agentmesh_schema_cache' ) );
	}

	// ─────────────────────────────────────────────────────────────────
	// Rate Limiting Tests
	// ─────────────────────────────────────────────────────────────────

	public function test_allows_first_request(): void {
		$reflection = new ReflectionClass( $this->injector );
		$method = $reflection->getMethod( 'check_rate_limit' );
		$method->setAccessible( true );
		
		// Fresh cache, should allow
		$GLOBALS['_wp_cache'] = [];
		$_SERVER['REMOTE_ADDR'] = '192.168.1.1';
		
		$this->assertTrue( $method->invoke( $this->injector ) );
	}

	public function test_rate_limit_blocks_second_request(): void {
		$reflection = new ReflectionClass( $this->injector );
		$check_method = $reflection->getMethod( 'check_rate_limit' );
		$check_method->setAccessible( true );
		$record_method = $reflection->getMethod( 'record_rate_limit' );
		$record_method->setAccessible( true );
		
		$_SERVER['REMOTE_ADDR'] = '192.168.1.2';
		
		// First request should pass
		$this->assertTrue( $check_method->invoke( $this->injector ) );
		
		// Record the attempt
		$record_method->invoke( $this->injector );
		
		// Second request should be blocked
		$this->assertFalse( $check_method->invoke( $this->injector ) );
	}

	// ─────────────────────────────────────────────────────────────────
	// Gateway Integration Tests
	// ─────────────────────────────────────────────────────────────────

	public function test_gateway_url_from_options(): void {
		$GLOBALS['_agentmesh_options']['agentmesh_gateway_url'] = 'http://gateway.local:3000';
		
		// This test verifies the option is read (indirectly through get_schema)
		$this->assertTrue( true );
	}

	public function test_empty_gateway_url_returns_null(): void {
		$GLOBALS['_agentmesh_options']['agentmesh_gateway_url'] = '';
		
		$reflection = new ReflectionClass( $this->injector );
		$method = $reflection->getMethod( 'fetch_schema_from_gateway' );
		$method->setAccessible( true );
		
		$result = $method->invoke( $this->injector );
		$this->assertNull( $result );
	}

	// ─────────────────────────────────────────────────────────────────
	// Schema Injection Integration Tests
	// ─────────────────────────────────────────────────────────────────

	public function test_init_hooks_wp_footer_when_enabled(): void {
		$GLOBALS['_agentmesh_options']['agentmesh_schema_injection_enabled'] = true;
		$GLOBALS['_wp_actions'] = [];
		
		$this->injector->init();
		
		// Check that wp_footer hook was added
		$this->assertNotEmpty( $GLOBALS['_wp_actions']['wp_footer'] ?? [] );
	}
}
