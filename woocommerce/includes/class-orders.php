<?php
/**
 * Orders endpoint — GET /connector/orders/{id}
 */

defined( 'ABSPATH' ) || exit;

class AgentMesh_Orders {

	private AgentMesh_Auth $auth;

	public function __construct() {
		$this->auth = new AgentMesh_Auth();
	}

	public function register_routes(): void {
		register_rest_route(
			AGENTMESH_REST_NAMESPACE,
			'/connector/orders',
			[
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => [ $this, 'list_orders' ],
				'permission_callback' => [ $this->auth, 'verify_connector_key' ],
				'args'                => [
					'page'     => [ 'default' => 1,  'sanitize_callback' => 'absint' ],
					'per_page' => [ 'default' => 20, 'sanitize_callback' => 'absint' ],
					'status'   => [ 'default' => 'any' ],
				],
			]
		);

		register_rest_route(
			AGENTMESH_REST_NAMESPACE,
			'/connector/orders/(?P<order_id>[\d]+)',
			[
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => [ $this, 'get_order' ],
				'permission_callback' => [ $this->auth, 'verify_connector_key' ],
				'args'                => [
					'order_id' => [
						'required'          => true,
						'validate_callback' => fn( $v ) => is_numeric( $v ) && $v > 0,
					],
				],
			]
		);
	}

	public function list_orders( WP_REST_Request $request ): WP_REST_Response {
		$page     = max( 1, (int) $request->get_param( 'page' ) );
		$per_page = min( 100, max( 1, (int) $request->get_param( 'per_page' ) ) );
		$status   = $request->get_param( 'status' ) ?: 'any';
		$site_id  = (string) get_option( 'agentmesh_site_id', '' );

		$query = new WC_Order_Query( [
			'limit'    => $per_page,
			'paged'    => $page,
			'status'   => $status,
			'orderby'  => 'date',
			'order'    => 'DESC',
			'return'   => 'objects',
		] );

		$orders = $query->get_orders();
		$total  = (int) ( new WC_Order_Query( [ 'status' => $status, 'return' => 'ids', 'limit' => -1 ] ) )->get_orders();
		// get_orders() with return=ids gives an array; count it
		$total_count = count( ( new WC_Order_Query( [ 'status' => $status, 'return' => 'ids', 'limit' => -1 ] ) )->get_orders() );

		$data = array_map(
			fn( $order ) => AgentMesh_Normaliser::order_to_amps( $order, $site_id ),
			$orders
		);

		$response = new WP_REST_Response( [
			'data'       => $data,
			'pagination' => [
				'page'     => $page,
				'limit'    => $per_page,
				'total'    => $total_count,
				'has_next' => ( $page * $per_page ) < $total_count,
			],
		], 200 );

		return AgentMesh_Auth::echo_request_id( $request, $response );
	}

	public function get_order( WP_REST_Request $request ): WP_REST_Response {
		$order_id = (int) $request->get_param( 'order_id' );
		$order    = wc_get_order( $order_id );

		if ( ! $order ) {
			$r = new WP_REST_Response(
				AgentMesh_Auth::error_response( 'NOT_FOUND', 'Order not found.' ),
				404
			);
			return AgentMesh_Auth::echo_request_id( $request, $r );
		}

		$site_id  = (string) get_option( 'agentmesh_site_id', '' );
		$response = new WP_REST_Response( AgentMesh_Normaliser::order_to_amps( $order, $site_id ), 200 );
		return AgentMesh_Auth::echo_request_id( $request, $response );
	}
}
