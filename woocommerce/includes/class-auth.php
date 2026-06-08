<?php
/**
 * Authentication — validates X-AgentMesh-Connector-Key on every REST request.
 */

defined( 'ABSPATH' ) || exit;

class AgentMesh_Auth {

	/**
	 * WP REST API permission_callback: validates the connector key header.
	 *
	 * Returns true on success, WP_Error on failure.
	 */
	public function verify_connector_key( WP_REST_Request $request ): bool|WP_Error {
		$stored_key = get_option( 'agentmesh_connector_key', '' );

		if ( empty( $stored_key ) ) {
			return new WP_Error(
				'connector_not_configured',
				'Synchronity connector key is not configured.',
				[ 'status' => 503 ]
			);
		}

		$provided_key = $request->get_header( 'X-AgentMesh-Connector-Key' );

		if ( empty( $provided_key ) ) {
			return new WP_Error(
				'missing_connector_key',
				'Missing X-AgentMesh-Connector-Key header.',
				[ 'status' => 401 ]
			);
		}

		if ( ! hash_equals( $stored_key, $provided_key ) ) {
			return new WP_Error(
				'invalid_connector_key',
				'Invalid connector key.',
				[ 'status' => 401 ]
			);
		}

		return true;
	}

	/**
	 * Echo the request ID header in a response for audit correlation.
	 */
	public static function echo_request_id( WP_REST_Request $request, WP_REST_Response $response ): WP_REST_Response {
		$request_id = $request->get_header( 'X-AgentMesh-Request-Id' );
		if ( $request_id ) {
			$response->header( 'X-AgentMesh-Request-Id', sanitize_text_field( $request_id ) );
		}
		return $response;
	}

	/**
	 * Build a standard AMPS error array for use in REST responses.
	 */
	public static function error_response( string $code, string $message, array $details = [] ): array {
		$error = [
			'code'    => $code,
			'message' => $message,
		];
		if ( ! empty( $details ) ) {
			$error['details'] = $details;
		}
		return [ 'error' => $error ];
	}
}
