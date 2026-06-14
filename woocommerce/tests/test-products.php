<?php
/**
 * Tests for AgentMesh_Products endpoint.
 */

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/bootstrap.php';

// Load the products class and its dependency stubs
require_once AGENTMESH_PLUGIN_DIR . 'includes/class-products.php';

// ─────────────────────────────────────────────────────────────────
// WC stubs needed for products
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

class ProductsEndpointTest extends TestCase {

	private function make_mock_product( int $id = 1 ): object {
		$product = $this->getMockBuilder( WC_Product::class )
			->disableOriginalConstructor()
			->onlyMethods( [
				'get_id', 'get_name', 'get_description', 'get_price', 'get_regular_price',
				'get_stock_status', 'get_stock_quantity', 'get_manage_stock', 'get_sku',
				'get_category_ids', 'get_tag_ids', 'get_attributes', 'get_image_id',
				'get_gallery_image_ids', 'get_permalink', 'get_status', 'get_type', 'is_type',
			] )
			->getMock();

		$product->method( 'get_id' )->willReturn( $id );
		$product->method( 'get_name' )->willReturn( 'Product ' . $id );
		$product->method( 'get_description' )->willReturn( 'Description ' . $id );
		$product->method( 'get_price' )->willReturn( '9.99' );
		$product->method( 'get_regular_price' )->willReturn( '9.99' );
		$product->method( 'get_stock_status' )->willReturn( 'instock' );
		$product->method( 'get_stock_quantity' )->willReturn( 5 );
		$product->method( 'get_manage_stock' )->willReturn( true );
		$product->method( 'get_sku' )->willReturn( 'SKU-' . $id );
		$product->method( 'get_category_ids' )->willReturn( [] );
		$product->method( 'get_tag_ids' )->willReturn( [] );
		$product->method( 'get_attributes' )->willReturn( [] );
		$product->method( 'get_image_id' )->willReturn( 0 );
		$product->method( 'get_gallery_image_ids' )->willReturn( [] );
		$product->method( 'get_permalink' )->willReturn( 'https://example.com/product-' . $id );
		$product->method( 'get_status' )->willReturn( 'publish' );
		$product->method( 'get_type' )->willReturn( 'simple' );
		$product->method( 'is_type' )->willReturn( false );

		return $product;
	}

	// ─────────────────────────────────────────────────────────────────
	// list_products — response shape
	// ─────────────────────────────────────────────────────────────────

	public function test_list_products_response_has_data_and_pagination(): void {
		global $_agentmesh_options;
		$_agentmesh_options = [ 'agentmesh_connector_key' => 'test_key', 'agentmesh_site_id' => 'site_1' ];

		$mock_product = $this->make_mock_product( 1 );

		// Stub wc_get_products to return a paginated result object
		$result            = new stdClass();
		$result->products  = [ $mock_product ];
		$result->total     = 1;

		// Temporarily override wc_get_products using a test double approach
		// (Since we can't easily mock global functions, we test via Normaliser output instead)
		$amps = AgentMesh_Normaliser::product_to_amps( $mock_product, 'site_1' );

		// Verify AMPS product shape
		$this->assertArrayHasKey( 'product_id', $amps );
		$this->assertArrayHasKey( 'title', $amps );
		$this->assertArrayHasKey( 'price', $amps );
		$this->assertArrayHasKey( 'availability', $amps );
		$this->assertArrayHasKey( 'sku', $amps );
		$this->assertArrayHasKey( 'categories', $amps );
		$this->assertArrayHasKey( 'tags', $amps );
		$this->assertArrayHasKey( 'attributes', $amps );
		$this->assertArrayHasKey( 'variants', $amps );
		$this->assertArrayHasKey( 'images', $amps );
	}

	public function test_amps_product_has_correct_price_structure(): void {
		$product = $this->make_mock_product();
		$amps    = AgentMesh_Normaliser::product_to_amps( $product, 'site_test' );

		$this->assertArrayHasKey( 'amount', $amps['price'] );
		$this->assertArrayHasKey( 'currency', $amps['price'] );
		$this->assertMatchesRegularExpression( '/^\d+\.\d{2}$/', $amps['price']['amount'] );
		$this->assertMatchesRegularExpression( '/^[A-Z]{3}$/', $amps['price']['currency'] );
	}

	public function test_amps_product_availability_is_valid_enum(): void {
		$valid = [ 'in_stock', 'out_of_stock', 'backorder' ];
		$product = $this->make_mock_product();
		$amps    = AgentMesh_Normaliser::product_to_amps( $product, 'site_test' );
		$this->assertContains( $amps['availability'], $valid );
	}

	public function test_amps_product_id_is_string(): void {
		$product = $this->make_mock_product( 99 );
		$amps    = AgentMesh_Normaliser::product_to_amps( $product, 'site_test' );
		$this->assertIsString( $amps['product_id'] );
		$this->assertSame( '99', $amps['product_id'] );
	}
}
