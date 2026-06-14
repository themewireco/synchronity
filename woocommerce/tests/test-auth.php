<?php
/**
 * Tests for AgentMesh_Auth connector key validation.
 */

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/bootstrap.php';

class AuthTest extends TestCase {

	private AgentMesh_Auth $auth;

	protected function setUp(): void {
		global $_agentmesh_options;
		$_agentmesh_options = [ 'agentmesh_connector_key' => 'secret_key_abc123' ];
		$this->auth         = new AgentMesh_Auth();
	}

	// ─────────────────────────────────────────────────────────────────
	// Correct key → passes
	// ─────────────────────────────────────────────────────────────────

	public function test_correct_key_returns_true(): void {
		$request = new WP_REST_Request();
		$request->set_header( 'X-AgentMesh-Connector-Key', 'secret_key_abc123' );

		$result = $this->auth->verify_connector_key( $request );
		$this->assertTrue( $result );
	}

	// ─────────────────────────────────────────────────────────────────
	// Wrong key → 401
	// ─────────────────────────────────────────────────────────────────

	public function test_wrong_key_returns_wp_error_401(): void {
		$request = new WP_REST_Request();
		$request->set_header( 'X-AgentMesh-Connector-Key', 'wrong_key' );

		$result = $this->auth->verify_connector_key( $request );

		$this->assertInstanceOf( WP_Error::class, $result );
		$this->assertSame( 'invalid_connector_key', $result->code );
		$this->assertSame( 401, $result->data['status'] );
	}

	// ─────────────────────────────────────────────────────────────────
	// Missing key → 401
	// ─────────────────────────────────────────────────────────────────

	public function test_missing_key_returns_wp_error_401(): void {
		$request = new WP_REST_Request();
		// No key header set

		$result = $this->auth->verify_connector_key( $request );

		$this->assertInstanceOf( WP_Error::class, $result );
		$this->assertSame( 'missing_connector_key', $result->code );
		$this->assertSame( 401, $result->data['status'] );
	}

	// ─────────────────────────────────────────────────────────────────
	// Unconfigured connector → 503
	// ─────────────────────────────────────────────────────────────────

	public function test_unconfigured_connector_returns_503(): void {
		global $_agentmesh_options;
		$_agentmesh_options = [ 'agentmesh_connector_key' => '' ];

		$request = new WP_REST_Request();
		$request->set_header( 'X-AgentMesh-Connector-Key', 'any_key' );

		$result = $this->auth->verify_connector_key( $request );

		$this->assertInstanceOf( WP_Error::class, $result );
		$this->assertSame( 'connector_not_configured', $result->code );
		$this->assertSame( 503, $result->data['status'] );
	}

	// ─────────────────────────────────────────────────────────────────
	// error_response shape
	// ─────────────────────────────────────────────────────────────────

	public function test_error_response_returns_amps_error_shape(): void {
		$result = AgentMesh_Auth::error_response( 'NOT_FOUND', 'Resource not found.' );

		$this->assertArrayHasKey( 'error', $result );
		$this->assertSame( 'NOT_FOUND', $result['error']['code'] );
		$this->assertSame( 'Resource not found.', $result['error']['message'] );
		$this->assertArrayNotHasKey( 'details', $result['error'] );
	}

	public function test_error_response_includes_details_when_provided(): void {
		$result = AgentMesh_Auth::error_response( 'BAD', 'Bad.', [ 'field' => 'email' ] );
		$this->assertArrayHasKey( 'details', $result['error'] );
		$this->assertSame( 'email', $result['error']['details']['field'] );
	}

	// ─────────────────────────────────────────────────────────────────
	// echo_request_id
	// ─────────────────────────────────────────────────────────────────

	public function test_echo_request_id_sets_response_header(): void {
		$request = new WP_REST_Request();
		$request->set_header( 'X-AgentMesh-Request-Id', 'req_TEST123' );
		$response = new WP_REST_Response( [], 200 );

		AgentMesh_Auth::echo_request_id( $request, $response );

		$headers = $response->get_headers();
		$this->assertArrayHasKey( 'X-AgentMesh-Request-Id', $headers );
		$this->assertSame( 'req_TEST123', $headers['X-AgentMesh-Request-Id'] );
	}

	public function test_echo_request_id_skips_when_no_header(): void {
		$request  = new WP_REST_Request();
		$response = new WP_REST_Response( [], 200 );

		AgentMesh_Auth::echo_request_id( $request, $response );

		$this->assertArrayNotHasKey( 'X-AgentMesh-Request-Id', $response->get_headers() );
	}
}
