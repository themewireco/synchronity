<?php
/**
 * Tests for AgentMesh_Cart endpoint.
 */

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/bootstrap.php';
require_once AGENTMESH_PLUGIN_DIR . 'includes/class-cart.php';

class CartEndpointTest extends TestCase {

	private AgentMesh_Cart $cart_handler;

	protected function setUp(): void {
		global $_agentmesh_options, $_transient_store;
		$_agentmesh_options = [
			'agentmesh_connector_key' => 'test_key',
			'agentmesh_site_id'       => 'site_test',
			'agentmesh_allow_cart'    => true,
		];
		$_transient_store = [];
		$this->cart_handler = new AgentMesh_Cart();
	}

	// ─────────────────────────────────────────────────────────────────
	// POST /connector/cart
	// ─────────────────────────────────────────────────────────────────

	public function test_create_cart_returns_201_with_required_fields(): void {
		$request = new WP_REST_Request();
		$request->set_header( 'X-AgentMesh-Connector-Key', 'test_key' );

		// Use reflection to call create_cart with overridden transient functions
		$this->overrideTransients();
		$response = $this->cart_handler->create_cart( $request );

		$this->assertSame( 201, $response->get_status() );
		$data = $response->get_data();

		$this->assertArrayHasKey( 'cart_id', $data );
		$this->assertArrayHasKey( 'site_id', $data );
		$this->assertArrayHasKey( 'items', $data );
		$this->assertArrayHasKey( 'subtotal', $data );
		$this->assertArrayHasKey( 'total', $data );
		$this->assertArrayHasKey( 'currency', $data );
		$this->assertArrayHasKey( 'expires_at', $data );
		$this->assertSame( [], $data['items'] );
		$this->assertSame( '0.00', $data['subtotal']['amount'] );
	}

	public function test_create_cart_uses_requested_currency(): void {
		$request = new WP_REST_Request();
		$request->set_param( 'currency', 'EUR' );
		$this->overrideTransients();

		$response = $this->cart_handler->create_cart( $request );
		$data     = $response->get_data();

		$this->assertSame( 'EUR', $data['currency'] );
	}

	// ─────────────────────────────────────────────────────────────────
	// Internal recalculate (via reflection)
	// ─────────────────────────────────────────────────────────────────

	public function test_recalculate_sums_line_totals(): void {
		$cart_data = [
			'currency'  => 'USD',
			'items'     => [
				[ 'item_id' => 'i1', 'line_total' => [ 'amount' => '10.00', 'currency' => 'USD' ] ],
				[ 'item_id' => 'i2', 'line_total' => [ 'amount' => '5.50', 'currency' => 'USD' ] ],
			],
			'discounts' => [],
		];

		$reflect    = new ReflectionClass( AgentMesh_Cart::class );
		$method     = $reflect->getMethod( 'recalculate' );
		$method->setAccessible( true );

		$result = $method->invoke( $this->cart_handler, $cart_data );

		$this->assertSame( '15.50', $result['subtotal']['amount'] );
		$this->assertSame( '15.50', $result['total']['amount'] );
	}

	public function test_recalculate_applies_discount(): void {
		$cart_data = [
			'currency'  => 'USD',
			'items'     => [
				[ 'item_id' => 'i1', 'line_total' => [ 'amount' => '20.00', 'currency' => 'USD' ] ],
			],
			'discounts' => [
				[ 'code' => 'SAVE5', 'amount' => [ 'amount' => '5.00', 'currency' => 'USD' ] ],
			],
		];

		$reflect = new ReflectionClass( AgentMesh_Cart::class );
		$method  = $reflect->getMethod( 'recalculate' );
		$method->setAccessible( true );
		$result  = $method->invoke( $this->cart_handler, $cart_data );

		$this->assertSame( '20.00', $result['subtotal']['amount'] );
		$this->assertSame( '15.00', $result['total']['amount'] );
	}

	public function test_total_never_goes_below_zero(): void {
		$cart_data = [
			'currency'  => 'USD',
			'items'     => [
				[ 'item_id' => 'i1', 'line_total' => [ 'amount' => '5.00', 'currency' => 'USD' ] ],
			],
			'discounts' => [
				[ 'code' => 'BIG', 'amount' => [ 'amount' => '100.00', 'currency' => 'USD' ] ],
			],
		];

		$reflect = new ReflectionClass( AgentMesh_Cart::class );
		$method  = $reflect->getMethod( 'recalculate' );
		$method->setAccessible( true );
		$result  = $method->invoke( $this->cart_handler, $cart_data );

		$this->assertSame( '0.00', $result['total']['amount'] );
	}

	// ─────────────────────────────────────────────────────────────────
	// Shipping: recalculate, option formatting, selection
	// ─────────────────────────────────────────────────────────────────

	public function test_recalculate_includes_shipping_total(): void {
		$cart_data = [
			'currency'       => 'USD',
			'items'          => [
				[ 'item_id' => 'i1', 'line_total' => [ 'amount' => '20.00', 'currency' => 'USD' ] ],
			],
			'discounts'      => [],
			'shipping_total' => [ 'amount' => '7.50', 'currency' => 'USD' ],
		];

		$reflect = new ReflectionClass( AgentMesh_Cart::class );
		$method  = $reflect->getMethod( 'recalculate' );
		$method->setAccessible( true );
		$result  = $method->invoke( $this->cart_handler, $cart_data );

		$this->assertSame( '20.00', $result['subtotal']['amount'] );
		$this->assertSame( '27.50', $result['total']['amount'] ); // 20 + 7.50 shipping
	}

	public function test_format_shipping_option_shapes_amps(): void {
		$reflect = new ReflectionClass( AgentMesh_Cart::class );
		$method  = $reflect->getMethod( 'format_shipping_option' );
		$method->setAccessible( true );

		$opt = $method->invoke( $this->cart_handler, 'flat_rate:3', 'Flat rate', 5.0, 'USD' );

		$this->assertSame( 'flat_rate:3', $opt['option_id'] );
		$this->assertSame( 'Flat rate', $opt['title'] );
		$this->assertSame( [ 'amount' => '5.00', 'currency' => 'USD' ], $opt['amount'] );
		$this->assertNull( $opt['description'] );
		$this->assertNull( $opt['estimated_delivery'] );
	}

	public function test_apply_selected_shipping_binds_total(): void {
		$cart_data = [
			'currency'         => 'USD',
			'items'            => [
				[ 'item_id' => 'i1', 'line_total' => [ 'amount' => '20.00', 'currency' => 'USD' ] ],
			],
			'discounts'        => [],
			'shipping_options' => [
				[ 'option_id' => 'flat_rate:3', 'title' => 'Flat', 'amount' => [ 'amount' => '5.00', 'currency' => 'USD' ] ],
			],
		];

		$reflect = new ReflectionClass( AgentMesh_Cart::class );
		$method  = $reflect->getMethod( 'apply_selected_shipping' );
		$method->setAccessible( true );
		[ $result, $err ] = $method->invoke( $this->cart_handler, $cart_data, 'flat_rate:3' );

		$this->assertNull( $err );
		$this->assertSame( 'flat_rate:3', $result['selected_shipping_option_id'] );
		$this->assertSame( [ 'amount' => '5.00', 'currency' => 'USD' ], $result['shipping_total'] );
		$this->assertSame( '25.00', $result['total']['amount'] ); // 20 + 5 shipping
	}

	public function test_apply_selected_shipping_rejects_unknown_option(): void {
		$cart_data = [ 'currency' => 'USD', 'items' => [], 'discounts' => [], 'shipping_options' => [] ];

		$reflect = new ReflectionClass( AgentMesh_Cart::class );
		$method  = $reflect->getMethod( 'apply_selected_shipping' );
		$method->setAccessible( true );
		[ , $err ] = $method->invoke( $this->cart_handler, $cart_data, 'nope' );

		$this->assertNotNull( $err );
		$this->assertStringContainsString( 're-fetch rates', $err );
	}

	// ─────────────────────────────────────────────────────────────────
	// Cart TTL
	// ─────────────────────────────────────────────────────────────────

	public function test_cart_ttl_constant_is_24_hours(): void {
		$this->assertSame( 86400, AgentMesh_Cart::CART_TTL );
	}

	// ─────────────────────────────────────────────────────────────────
	// Helper: override transient functions in test context
	// ─────────────────────────────────────────────────────────────────

	private function overrideTransients(): void {
		// Transients are already stubbed in bootstrap.php to be no-ops.
		// This is sufficient for create_cart tests.
	}
}
