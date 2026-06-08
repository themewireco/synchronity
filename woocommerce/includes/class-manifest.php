<?php
/**
 * Manifest endpoint — GET /connector/manifest
 * Returns AMPSCapabilityManifest describing this site's capabilities.
 */

defined( 'ABSPATH' ) || exit;

class AgentMesh_Manifest {

	private AgentMesh_Auth $auth;

	public function __construct() {
		$this->auth = new AgentMesh_Auth();
	}

	public function register_routes(): void {
		register_rest_route(
			AGENTMESH_REST_NAMESPACE,
			'/connector/manifest',
			[
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => [ $this, 'get_manifest' ],
				'permission_callback' => [ $this->auth, 'verify_connector_key' ],
			]
		);
	}

	public function get_manifest( WP_REST_Request $request ): WP_REST_Response {
		$manifest = [
			'site_id'          => (string) get_option( 'agentmesh_site_id', '' ),
			'platform'         => 'woocommerce',
			'platform_version' => WC()->version,
			'agentmesh_version' => AGENTMESH_VERSION,
			'capabilities'     => [
				'product_search'       => true,
				'product_compare'      => true,
				'product_reviews'      => true,
				'cart_management'      => (bool) get_option( 'agentmesh_allow_cart', true ),
				'coupon_support'       => true,
				'checkout_execution'   => (bool) get_option( 'agentmesh_allow_checkout', true ),
				'order_tracking'       => true,
				'real_time_inventory'  => true,
				'shipping_quotes'      => true,
				'guest_checkout'       => 'yes' === get_option( 'woocommerce_enable_guest_checkout' ),
				'authenticated_checkout' => true,
			],
			'api_base_url'         => get_site_url() . '/wp-json/' . AGENTMESH_REST_NAMESPACE,
			'supported_currencies' => [ get_woocommerce_currency() ],
			'shipping_zones'       => $this->get_shipping_zones(),
		];

		$response = new WP_REST_Response( $manifest, 200 );
		return AgentMesh_Auth::echo_request_id( $request, $response );
	}

	/**
	 * Retrieve WooCommerce shipping zones formatted as AMPSShippingZone[].
	 */
	private function get_shipping_zones(): array {
		$zones  = WC_Shipping_Zones::get_zones();
		$result = [];

		foreach ( $zones as $zone_data ) {
			$zone      = new WC_Shipping_Zone( $zone_data['id'] );
			$locations = $zone->get_zone_locations();

			foreach ( $locations as $location ) {
				if ( 'country' === $location->type ) {
					$result[] = [ 'country_code' => $location->code ];
				} elseif ( 'state' === $location->type ) {
					// state codes are in "CC:ST" format
					[ $country, $state ] = explode( ':', $location->code, 2 );
					$existing_key = null;
					foreach ( $result as $k => $z ) {
						if ( $z['country_code'] === $country ) {
							$existing_key = $k;
							break;
						}
					}
					if ( null !== $existing_key ) {
						$result[ $existing_key ]['regions'][] = $state;
					} else {
						$result[] = [ 'country_code' => $country, 'regions' => [ $state ] ];
					}
				}
			}
		}

		// Include "Rest of World" zone countries if present
		$row_zone  = new WC_Shipping_Zone( 0 );
		$row_locs  = $row_zone->get_zone_locations();
		foreach ( $row_locs as $location ) {
			if ( 'country' === $location->type ) {
				$result[] = [ 'country_code' => $location->code ];
			}
		}

		return array_values( $result );
	}
}
