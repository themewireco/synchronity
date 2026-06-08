<?php
/**
 * Product Reviews endpoints.
 *  GET /connector/products/{id}/reviews — product reviews with trust scores
 */

defined( 'ABSPATH' ) || exit;

class AgentMesh_Reviews_Endpoint {

	private AgentMesh_Auth $auth;

	public function __construct() {
		$this->auth = new AgentMesh_Auth();
	}

	public function register_routes(): void {
		register_rest_route(
			AGENTMESH_REST_NAMESPACE,
			'/connector/products/(?P<product_id>[\d]+)/reviews',
			[
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => [ $this, 'get_reviews' ],
				'permission_callback' => [ $this->auth, 'verify_connector_key' ],
				'args'                => [
					'product_id' => [
						'required'          => true,
						'validate_callback' => fn( $v ) => is_numeric( $v ) && $v > 0,
					],
					'limit'      => [
						'required' => false,
						'default'  => 10,
						'type'     => 'integer',
					],
					'page'       => [
						'required' => false,
						'default'  => 1,
						'type'     => 'integer',
					],
				],
			]
		);
	}

	public function get_reviews( WP_REST_Request $request ): WP_REST_Response {
		$product_id = (int) $request->get_param( 'product_id' );
		$page       = max( 1, (int) $request->get_param( 'page' ) ?: 1 );
		$limit      = min( 100, max( 1, (int) $request->get_param( 'limit' ) ?: 10 ) );
		$site_id    = (string) get_option( 'agentmesh_site_id', '' );

		$product = wc_get_product( $product_id );
		if ( ! $product ) {
			$response = new WP_REST_Response(
				[
					'error' => [
						'code'    => 'PRODUCT_NOT_FOUND',
						'message' => "Product {$product_id} not found",
					],
				],
				404
			);
			return AgentMesh_Auth::echo_request_id( $request, $response );
		}

		// Get consensus & trust score
		$consensus = AgentMesh_Reviews::calculate_consensus( $product_id );

		// Get paginated reviews
		$reviews = get_comments(
			[
				'post_id' => $product_id,
				'number'  => $limit,
				'offset'  => ( $page - 1 ) * $limit,
				'status'  => 'approve',
			]
		);

		$normalized_reviews = [];
		foreach ( $reviews as $review ) {
			$normalized_reviews[] = AgentMesh_Review_Normaliser::normalize_review( $review, $product_id );
		}

		$total_reviews = (int) get_comments(
			[
				'post_id'     => $product_id,
				'count'       => true,
				'status'      => 'approve',
			]
		);

		$has_next = ( $page * $limit ) < $total_reviews;

		// Include product info with images for context
		$product_data = AgentMesh_Normaliser::product_to_amps( $product, $site_id );

		$body = [
			'data' => [
				'product_id'   => $product_id,
				'product'      => [
					'id'        => (string) $product_id,
					'name'      => $product->get_name(),
					'price'     => $product->get_price(),
					'image_url' => $product_data['image_url'] ?? null,
					'images'    => $product_data['images'] ?? [],
				],
				'consensus'    => $consensus,
				'reviews'      => $normalized_reviews,
			],
			'pagination' => [
				'page'     => $page,
				'limit'    => $limit,
				'total'    => $total_reviews,
				'has_next' => $has_next,
			],
		];

		$response = new WP_REST_Response( $body, 200 );
		return AgentMesh_Auth::echo_request_id( $request, $response );
	}
}

