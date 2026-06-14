<?php
/**
 * Tests for AgentMesh_Addons (ACF Product Add-ons).
 *
 * ACF (get_field_objects/get_field) and WC_Product are stubbed in-process, so no
 * real WordPress/WooCommerce/ACF install is required. The exhaustive matrix lives
 * in tests/run-addons-tests.php; this mirrors the key cases under PHPUnit.
 */

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/bootstrap.php';

// ─────────────────────────────────────────────────────────────────
// Stubs not present in bootstrap.php
// ─────────────────────────────────────────────────────────────────

if ( ! function_exists( 'sanitize_title' ) ) {
	function sanitize_title( $str ): string {
		$s = strtolower( trim( (string) $str ) );
		$s = preg_replace( '/[^a-z0-9]+/', '-', $s );
		return trim( (string) $s, '-' );
	}
}

if ( ! function_exists( 'get_field_objects' ) ) {
	function get_field_objects( $post_id ) { return $GLOBALS['_acf_fields'][ $post_id ] ?? []; }
}
if ( ! function_exists( 'get_field' ) ) {
	function get_field( $ref, $post_id ) { return $GLOBALS['_acf_values'][ $post_id ][ $ref ] ?? null; }
}

if ( ! class_exists( 'WC_Product' ) ) {
	class WC_Product {
		public function __construct( private int $id = 1, private float $price = 100.0 ) {}
		public function get_id(): int { return $this->id; }
		public function get_price(): string { return number_format( $this->price, 2, '.', '' ); }
	}
}

require_once AGENTMESH_PLUGIN_DIR . 'includes/class-addons.php';

class AddonsTest extends TestCase {

	protected function setUp(): void {
		global $_agentmesh_options;
		$_agentmesh_options     = [ 'agentmesh_addons_enabled' => true ];
		$GLOBALS['_acf_fields'] = [];
		$GLOBALS['_acf_values'] = [];
	}

	private function product( array $fields, array $values = [], float $price = 100.0 ): WC_Product {
		$GLOBALS['_acf_fields'][1] = $fields;
		$GLOBALS['_acf_values'][1] = $values;
		return new WC_Product( 1, $price );
	}

	private function addon( array $addons, string $id ): ?array {
		foreach ( $addons as $a ) { if ( $a['addon_id'] === $id ) return $a; }
		return null;
	}

	public function test_type_mapping_and_skips(): void {
		$p = $this->product( [
			'sel'  => [ 'name' => 'sel', 'type' => 'select', 'label' => 'Sel', 'choices' => [ 'a' => 'A' ] ],
			'msel' => [ 'name' => 'msel', 'type' => 'select', 'multiple' => 1, 'label' => 'M', 'choices' => [ 'a' => 'A' ] ],
			'rad'  => [ 'name' => 'rad', 'type' => 'radio', 'label' => 'R', 'choices' => [ 'a' => 'A' ] ],
			'chk'  => [ 'name' => 'chk', 'type' => 'checkbox', 'label' => 'C', 'choices' => [ 'a' => 'A' ] ],
			'tf'   => [ 'name' => 'tf', 'type' => 'true_false', 'label' => 'T' ],
			'txt'  => [ 'name' => 'txt', 'type' => 'text', 'label' => 'X' ],
			'num'  => [ 'name' => 'num', 'type' => 'number', 'label' => 'N', 'min' => 1, 'max' => 9 ],
			'img'  => [ 'name' => 'img', 'type' => 'image', 'label' => 'I' ],
		] );
		$a = AgentMesh_Addons::extract_addons( $p );

		self::assertSame( 'select', $this->addon( $a, 'sel' )['type'] );
		self::assertSame( 'checkbox', $this->addon( $a, 'msel' )['type'] );
		self::assertSame( 'radio', $this->addon( $a, 'rad' )['type'] );
		self::assertSame( 'checkbox', $this->addon( $a, 'chk' )['type'] );
		self::assertSame( 'boolean', $this->addon( $a, 'tf' )['type'] );
		self::assertSame( 'text', $this->addon( $a, 'txt' )['type'] );
		self::assertSame( 'number', $this->addon( $a, 'num' )['type'] );
		self::assertSame( 1.0, $this->addon( $a, 'num' )['min'] );
		self::assertNull( $this->addon( $a, 'img' ) );
		self::assertCount( 7, $a );
	}

	public function test_acf_absent_or_disabled_returns_empty(): void {
		global $_agentmesh_options;
		$_agentmesh_options['agentmesh_addons_enabled'] = false;
		$p = $this->product( [ 'x' => [ 'name' => 'x', 'type' => 'text', 'label' => 'X' ] ] );
		self::assertSame( [], AgentMesh_Addons::extract_addons( $p ) );
	}

	public function test_repeater_options_with_price_subfield(): void {
		$p = $this->product( [
			'extras' => [
				'name' => 'extras', 'type' => 'repeater', 'label' => 'Extras',
				'sub_fields' => [ [ 'name' => 'label', 'type' => 'text' ], [ 'name' => 'price', 'type' => 'number' ] ],
				'value' => [ [ 'label' => 'Cheese', 'price' => 5 ], [ 'price' => 9 ] ],
			],
		] );
		$rep = $this->addon( AgentMesh_Addons::extract_addons( $p ), 'extras' );
		self::assertSame( 'checkbox', $rep['type'] );
		self::assertCount( 1, $rep['options'] );
		self::assertSame( 'cheese', $rep['options'][0]['value'] );
		self::assertSame( '5.00', $rep['options'][0]['price_modifier']['amount'] );
	}

	public function test_hide_list_filtering(): void {
		global $_agentmesh_options;
		$_agentmesh_options['agentmesh_addon_hidden_fields'] = 'secret';
		$p = $this->product( [
			'shown'  => [ 'name' => 'shown', 'type' => 'text', 'label' => 'S' ],
			'secret' => [ 'name' => 'secret', 'type' => 'text', 'label' => 'X' ],
		] );
		$a = AgentMesh_Addons::extract_addons( $p );
		self::assertCount( 1, $a );
		self::assertSame( 'shown', $a[0]['addon_id'] );
	}

	public function test_price_map_and_label_suffix(): void {
		global $_agentmesh_options;
		$_agentmesh_options['agentmesh_addon_price_map'] = json_encode( [
			'size'      => [ 'options' => [ 'lg' => '5.00' ] ],
			'engraving' => [ 'price_field' => 'field_engrave' ],
		] );
		$p = $this->product(
			[
				'size'      => [ 'name' => 'size', 'type' => 'radio', 'label' => 'Size', 'choices' => [ 'sm' => 'Small', 'lg' => 'Large' ] ],
				'topping'   => [ 'name' => 'topping', 'type' => 'radio', 'label' => 'T', 'choices' => [ 'c' => 'Cheese (+2.50)' ] ],
				'engraving' => [ 'name' => 'engraving', 'type' => 'select', 'label' => 'E', 'choices' => [ 'y' => 'Yes' ] ],
			],
			[ 'field_engrave' => 12 ]
		);
		$a    = AgentMesh_Addons::extract_addons( $p );
		$size = $this->addon( $a, 'size' );
		self::assertSame( '5.00', $size['options'][1]['price_modifier']['amount'] );
		$top = $this->addon( $a, 'topping' );
		self::assertSame( '2.50', $top['options'][0]['price_modifier']['amount'] );
		$eng = $this->addon( $a, 'engraving' );
		self::assertSame( '12.00', $eng['options'][0]['price_modifier']['amount'] );
	}

	public function test_validate_required_missing(): void {
		$p   = $this->product( [ 'size' => [ 'name' => 'size', 'type' => 'radio', 'label' => 'S', 'required' => 1, 'choices' => [ 'sm' => 'Small' ] ] ] );
		$def = AgentMesh_Addons::extract_addons( $p );
		$res = AgentMesh_Addons::validate_and_resolve_selection( $def, [] );
		self::assertInstanceOf( WP_Error::class, $res );
		self::assertSame( 'ADDON_REQUIRED', $res->get_error_code() );
	}

	public function test_validate_invalid_and_range(): void {
		$p = $this->product( [
			'size' => [ 'name' => 'size', 'type' => 'radio', 'label' => 'S', 'choices' => [ 'sm' => 'Small' ] ],
			'qty'  => [ 'name' => 'qty', 'type' => 'number', 'label' => 'Q', 'min' => 1, 'max' => 5 ],
		] );
		$def = AgentMesh_Addons::extract_addons( $p );
		self::assertSame( 'ADDON_INVALID_OPTION', AgentMesh_Addons::validate_and_resolve_selection( $def, [ 'size' => 'xl' ] )->get_error_code() );
		self::assertSame( 'ADDON_OUT_OF_RANGE', AgentMesh_Addons::validate_and_resolve_selection( $def, [ 'qty' => 99 ] )->get_error_code() );
		self::assertSame( 'ADDON_UNKNOWN', AgentMesh_Addons::validate_and_resolve_selection( $def, [ 'nope' => 1 ] )->get_error_code() );
	}

	public function test_validate_modifier_math(): void {
		$p = $this->product( [
			'size'  => [ 'name' => 'size', 'type' => 'radio', 'label' => 'S', 'choices' => [ 'sm' => 'Small', 'lg' => 'Large (+5)' ] ],
			'extra' => [ 'name' => 'extra', 'type' => 'checkbox', 'label' => 'E', 'choices' => [ 'a' => 'A (+2)', 'b' => 'B (+3)' ] ],
		] );
		$def = AgentMesh_Addons::extract_addons( $p );
		$res = AgentMesh_Addons::validate_and_resolve_selection( $def, [ 'size' => 'lg', 'extra' => [ 'a', 'b' ] ] );
		self::assertIsArray( $res );
		self::assertSame( 10.0, $res['modifier_total'] );
		self::assertCount( 2, $res['selected'] );
	}
}
