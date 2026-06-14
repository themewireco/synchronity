<?php
/**
 * Tests for AgentMesh_Normaliser.
 */

declare(strict_types=1);

use PHPUnit\Framework\TestCase;
use PHPUnit\Framework\MockObject\MockObject;

require_once __DIR__ . '/bootstrap.php';

class NormaliserTest extends TestCase {

	// ─────────────────────────────────────────────────────────────────
	// Helpers
	// ─────────────────────────────────────────────────────────────────

	private function make_simple_product( array $overrides = [] ): MockObject {
		$product = $this->getMockBuilder( WC_Product::class )
			->disableOriginalConstructor()
			->onlyMethods( [
				'get_id', 'get_name', 'get_description', 'get_price',
				'get_regular_price', 'get_stock_status', 'get_stock_quantity',
				'get_manage_stock', 'get_sku', 'get_category_ids', 'get_tag_ids',
				'get_attributes', 'get_image_id', 'get_gallery_image_ids',
				'get_permalink', 'get_status', 'get_type', 'is_type',
			] )
			->getMock();

		$defaults = [
			'get_id'               => 42,
			'get_name'             => 'Test Widget',
			'get_description'      => 'A test widget.',
			'get_price'            => '19.99',
			'get_regular_price'    => '24.99',
			'get_stock_status'     => 'instock',
			'get_stock_quantity'   => 10,
			'get_manage_stock'     => true,
			'get_sku'              => 'WIDGET-001',
			'get_category_ids'     => [],
			'get_tag_ids'          => [],
			'get_attributes'       => [],
			'get_image_id'         => 0,
			'get_gallery_image_ids' => [],
			'get_permalink'        => 'https://example.com/product/test-widget',
			'get_status'           => 'publish',
			'get_type'             => 'simple',
			'is_type'              => false,
		];

		foreach ( array_merge( $defaults, $overrides ) as $method => $value ) {
			$product->method( $method )->willReturn( $value );
		}

		return $product;
	}

	// ─────────────────────────────────────────────────────────────────
	// product_to_amps — basic shape
	// ─────────────────────────────────────────────────────────────────

	public function test_product_to_amps_returns_required_fields(): void {
		$product = $this->make_simple_product();
		$amps    = AgentMesh_Normaliser::product_to_amps( $product, 'site_test' );

		$this->assertSame( '42', $amps['product_id'] );
		$this->assertSame( 'site_test', $amps['site_id'] );
		$this->assertSame( 'Test Widget', $amps['title'] );
		$this->assertIsArray( $amps['price'] );
		$this->assertIsArray( $amps['categories'] );
		$this->assertIsArray( $amps['tags'] );
		$this->assertIsArray( $amps['attributes'] );
		$this->assertIsArray( $amps['variants'] );
		$this->assertIsArray( $amps['images'] );
	}

	// ─────────────────────────────────────────────────────────────────
	// Price formatting — 2dp string
	// ─────────────────────────────────────────────────────────────────

	public function test_price_formatted_as_two_decimal_string(): void {
		$product = $this->make_simple_product( [ 'get_price' => '5' ] );
		$amps    = AgentMesh_Normaliser::product_to_amps( $product, 'site_test' );

		$this->assertSame( '5.00', $amps['price']['amount'] );
		$this->assertMatchesRegularExpression( '/^\d+\.\d{2}$/', $amps['price']['amount'] );
	}

	public function test_price_with_many_decimals_is_rounded_to_two(): void {
		$product = $this->make_simple_product( [ 'get_price' => '9.9999' ] );
		$amps    = AgentMesh_Normaliser::product_to_amps( $product, 'site_test' );
		$this->assertSame( '10.00', $amps['price']['amount'] );
	}

	// ─────────────────────────────────────────────────────────────────
	// compare_at_price only set when regular > sale
	// ─────────────────────────────────────────────────────────────────

	public function test_compare_at_price_set_when_on_sale(): void {
		$product = $this->make_simple_product( [
			'get_price'         => '19.99',
			'get_regular_price' => '24.99',
		] );
		$amps = AgentMesh_Normaliser::product_to_amps( $product, 'site_test' );
		$this->assertNotNull( $amps['compare_at_price'] );
		$this->assertSame( '24.99', $amps['compare_at_price']['amount'] );
	}

	public function test_compare_at_price_null_when_not_on_sale(): void {
		$product = $this->make_simple_product( [
			'get_price'         => '24.99',
			'get_regular_price' => '24.99',
		] );
		$amps = AgentMesh_Normaliser::product_to_amps( $product, 'site_test' );
		$this->assertNull( $amps['compare_at_price'] );
	}

	// ─────────────────────────────────────────────────────────────────
	// Availability mapping
	// ─────────────────────────────────────────────────────────────────

	/** @dataProvider stockStatusProvider */
	public function test_availability_mapping( string $wc_status, string $expected_amps ): void {
		$this->assertSame( $expected_amps, AgentMesh_Normaliser::map_stock_status( $wc_status ) );
	}

	public function stockStatusProvider(): array {
		return [
			[ 'instock',     'in_stock' ],
			[ 'outofstock',  'out_of_stock' ],
			[ 'onbackorder', 'backorder' ],
			[ 'unknown',     'out_of_stock' ],  // safe default
		];
	}

	// ─────────────────────────────────────────────────────────────────
	// Stock quantity — int or null
	// ─────────────────────────────────────────────────────────────────

	public function test_stock_quantity_is_int_when_managed(): void {
		$product = $this->make_simple_product( [
			'get_manage_stock'   => true,
			'get_stock_quantity' => 7,
		] );
		$amps = AgentMesh_Normaliser::product_to_amps( $product, 'site_test' );
		$this->assertSame( 7, $amps['stock_quantity'] );
	}

	public function test_stock_quantity_null_when_not_managed(): void {
		$product = $this->make_simple_product( [ 'get_manage_stock' => false ] );
		$amps    = AgentMesh_Normaliser::product_to_amps( $product, 'site_test' );
		$this->assertNull( $amps['stock_quantity'] );
	}

	// ─────────────────────────────────────────────────────────────────
	// image_url — null when no image
	// ─────────────────────────────────────────────────────────────────

	public function test_image_url_null_when_no_image(): void {
		$product = $this->make_simple_product( [ 'get_image_id' => 0 ] );
		$amps    = AgentMesh_Normaliser::product_to_amps( $product, 'site_test' );
		$this->assertNull( $amps['image_url'] );
		$this->assertSame( [], $amps['images'] );
	}

	public function test_image_url_set_when_image_exists(): void {
		$product = $this->make_simple_product( [ 'get_image_id' => 55 ] );
		$amps    = AgentMesh_Normaliser::product_to_amps( $product, 'site_test' );
		$this->assertStringContainsString( 'example.com', $amps['image_url'] );
		$this->assertCount( 1, $amps['images'] );
	}

	// ─────────────────────────────────────────────────────────────────
	// Missing optional fields use null, not empty string
	// ─────────────────────────────────────────────────────────────────

	public function test_description_null_when_empty(): void {
		$product = $this->make_simple_product( [ 'get_description' => '' ] );
		$amps    = AgentMesh_Normaliser::product_to_amps( $product, 'site_test' );
		$this->assertNull( $amps['description'] );
	}

	public function test_url_null_when_no_permalink(): void {
		$product = $this->make_simple_product( [ 'get_permalink' => '' ] );
		$amps    = AgentMesh_Normaliser::product_to_amps( $product, 'site_test' );
		$this->assertNull( $amps['url'] );
	}

	// ─────────────────────────────────────────────────────────────────
	// map_order_status
	// ─────────────────────────────────────────────────────────────────

	/** @dataProvider orderStatusProvider */
	public function test_order_status_mapping( string $wc_status, string $expected ): void {
		$this->assertSame( $expected, AgentMesh_Normaliser::map_order_status( $wc_status ) );
	}

	public function orderStatusProvider(): array {
		return [
			[ 'pending',    'pending' ],
			[ 'processing', 'processing' ],
			[ 'completed',  'completed' ],
			[ 'cancelled',  'cancelled' ],
			[ 'refunded',   'refunded' ],
			[ 'on-hold',    'pending' ],
			[ 'failed',     'cancelled' ],
		];
	}

	// ─────────────────────────────────────────────────────────────────
	// amps_address_to_wc
	// ─────────────────────────────────────────────────────────────────

	public function test_amps_address_maps_to_wc_keys(): void {
		$amps_addr = [
			'line1'        => '123 Main St',
			'line2'        => 'Apt 4',
			'city'         => 'Springfield',
			'state'        => 'IL',
			'postal_code'  => '62701',
			'country_code' => 'US',
		];
		$wc = AgentMesh_Normaliser::amps_address_to_wc( $amps_addr );

		$this->assertSame( '123 Main St', $wc['address_1'] );
		$this->assertSame( 'Apt 4', $wc['address_2'] );
		$this->assertSame( 'Springfield', $wc['city'] );
		$this->assertSame( 'IL', $wc['state'] );
		$this->assertSame( '62701', $wc['postcode'] );
		$this->assertSame( 'US', $wc['country'] );
	}
}

// ─────────────────────────────────────────────────────────────────
// Minimal WC_Product stub for tests
// ─────────────────────────────────────────────────────────────────

if ( ! class_exists( 'WC_Product' ) ) {
	abstract class WC_Product {
		abstract public function get_id(): int;
		abstract public function get_name(): string;
		abstract public function get_description(): string;
		abstract public function get_price(): string;
		abstract public function get_regular_price(): string;
		abstract public function get_stock_status(): string;
		abstract public function get_stock_quantity(): ?int;
		abstract public function get_manage_stock(): bool;
		abstract public function get_sku(): string;
		abstract public function get_category_ids(): array;
		abstract public function get_tag_ids(): array;
		abstract public function get_attributes(): array;
		abstract public function get_image_id(): int;
		abstract public function get_gallery_image_ids(): array;
		abstract public function get_permalink(): string;
		abstract public function get_status(): string;
		abstract public function get_type(): string;
		abstract public function is_type( string $type ): bool;
	}
}
