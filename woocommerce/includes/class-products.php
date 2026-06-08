<?php
/**
 * Products endpoints.
 *  GET /connector/products        — paginated search
 *  GET /connector/products/{id}   — single product
 */

defined( 'ABSPATH' ) || exit;

class AgentMesh_Products {

	private AgentMesh_Auth $auth;

	public function __construct() {
		$this->auth = new AgentMesh_Auth();
	}

	public function register_routes(): void {
		register_rest_route(
			AGENTMESH_REST_NAMESPACE,
			'/connector/products',
			[
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => [ $this, 'list_products' ],
				'permission_callback' => [ $this->auth, 'verify_connector_key' ],
				'args'                => $this->list_args(),
			]
		);

		register_rest_route(
			AGENTMESH_REST_NAMESPACE,
			'/connector/products/(?P<id>[\d]+)',
			[
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => [ $this, 'get_product' ],
				'permission_callback' => [ $this->auth, 'verify_connector_key' ],
				'args'                => [
					'id' => [
						'required'          => true,
						'validate_callback' => fn( $v ) => is_numeric( $v ) && $v > 0,
					],
				],
			]
		);
	}

	public function list_products( WP_REST_Request $request ): WP_REST_Response {
		$page     = max( 1, (int) $request->get_param( 'page' ) ?: 1 );
		$limit    = min( 100, max( 1, (int) $request->get_param( 'limit' ) ?: 20 ) );
		$site_id  = (string) get_option( 'agentmesh_site_id', '' );

		$args = [
			'status'   => 'publish',
			'limit'    => $limit,
			'page'     => $page,
			'paginate' => true,
			'return'   => 'objects',
		];

		if ( $q = $request->get_param( 'q' ) ) {
			$args['s'] = sanitize_text_field( $q );
		}

		if ( $category = $request->get_param( 'category' ) ) {
			$args['category'] = [ sanitize_text_field( $category ) ];
		}

		if ( null !== $request->get_param( 'min_price' ) ) {
			$args['min_price'] = (float) $request->get_param( 'min_price' );
		}

		if ( null !== $request->get_param( 'max_price' ) ) {
			$args['max_price'] = (float) $request->get_param( 'max_price' );
		}

		if ( null !== $request->get_param( 'in_stock' ) ) {
			$args['stock_status'] = filter_var( $request->get_param( 'in_stock' ), FILTER_VALIDATE_BOOLEAN )
				? 'instock'
				: 'outofstock';
		}

		$result   = wc_get_products( $args );
		$products = [];

		foreach ( $result->products as $product ) {
			$products[] = AgentMesh_Normaliser::product_to_amps( $product, $site_id );
		}

		$total      = (int) $result->total;
		$has_next   = ( $page * $limit ) < $total;

		$body = [
			'data'       => $products,
			'pagination' => [
				'page'     => $page,
				'limit'    => $limit,
				'total'    => $total,
				'has_next' => $has_next,
			],
		];

		$response = new WP_REST_Response( $body, 200 );
		return AgentMesh_Auth::echo_request_id( $request, $response );
	}

	public function get_product( WP_REST_Request $request ): WP_REST_Response {
		$product_id = (int) $request->get_param( 'id' );
		$product    = wc_get_product( $product_id );

		if ( ! $product || 'publish' !== $product->get_status() ) {
			$response = new WP_REST_Response(
				AgentMesh_Auth::error_response( 'NOT_FOUND', 'Product not found.' ),
				404
			);
			return AgentMesh_Auth::echo_request_id( $request, $response );
		}

		$site_id  = (string) get_option( 'agentmesh_site_id', '' );
		$response = new WP_REST_Response( AgentMesh_Normaliser::product_to_amps( $product, $site_id ), 200 );
		return AgentMesh_Auth::echo_request_id( $request, $response );
	}

	private function list_args(): array {
		return [
			'q'         => [ 'type' => 'string', 'sanitize_callback' => 'sanitize_text_field' ],
			'category'  => [ 'type' => 'string', 'sanitize_callback' => 'sanitize_text_field' ],
			'min_price' => [ 'type' => 'number', 'minimum' => 0 ],
			'max_price' => [ 'type' => 'number', 'minimum' => 0 ],
			'in_stock'  => [ 'type' => 'boolean' ],
			'page'      => [ 'type' => 'integer', 'minimum' => 1, 'default' => 1 ],
			'limit'     => [ 'type' => 'integer', 'minimum' => 1, 'maximum' => 100, 'default' => 20 ],
		];
	}
}
