<?php
/**
 * Rotate-key endpoint — POST /connector/rotate-key
 *
 * Called by the Synchronity gateway after a merchant clicks "Rotate connector
 * key" in the dashboard. The gateway authenticates with the CURRENT key (via
 * the standard X-AgentMesh-Connector-Key header → verify_connector_key); on
 * success this endpoint mints a fresh local key, persists it, and returns it
 * so the gateway can store the new value on its side.
 */

defined( 'ABSPATH' ) || exit;

class AgentMesh_Rotate_Key {

	private AgentMesh_Auth $auth;

	public function __construct() {
		$this->auth = new AgentMesh_Auth();
	}

	public function register_routes(): void {
		register_rest_route(
			AGENTMESH_REST_NAMESPACE,
			'/connector/rotate-key',
			[
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => [ $this, 'rotate' ],
				'permission_callback' => [ $this->auth, 'verify_connector_key' ],
			]
		);
	}

	public function rotate( WP_REST_Request $request ): WP_REST_Response {
		$new_key = 'amck_' . bin2hex( random_bytes( 32 ) );
		update_option( 'agentmesh_connector_key', $new_key );

		$response = new WP_REST_Response(
			[
				'new_key'    => $new_key,
				'rotated_at' => gmdate( 'c' ),
			],
			200
		);
		return AgentMesh_Auth::echo_request_id( $request, $response );
	}
}
