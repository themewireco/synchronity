#!/usr/bin/env php
<?php
/**
 * Self-contained test runner for the ACF Product Add-ons connector layer
 * (class-addons.php: extract_addons, price resolution, validate_and_resolve_selection).
 *
 * Runs without Composer/PHPUnit:  php tests/run-addons-tests.php
 *
 * Stubs ACF (get_field_objects/get_field), WP options, and a minimal WC_Product.
 */

error_reporting( E_ALL );
ini_set( 'display_errors', '1' );

define( 'ABSPATH', __DIR__ . '/' );
define( 'AGENTMESH_VERSION', '0.1.0' );
define( 'AGENTMESH_PLUGIN_DIR', dirname( __DIR__ ) . '/' );
define( 'AGENTMESH_REST_NAMESPACE', 'agentmesh/v1' );

// ─────────────────────────────────────────────────────────────────
// WordPress / WooCommerce stubs (guarded — no redeclaring native fns)
// ─────────────────────────────────────────────────────────────────

$_agentmesh_options    = [];
$GLOBALS['_acf_fields'] = [];   // product_id → field-objects map
$GLOBALS['_acf_values'] = [];   // product_id → [field_ref => value]

function get_option( $key, $default = false ) {
	global $_agentmesh_options;
	return $_agentmesh_options[ $key ] ?? $default;
}

function get_woocommerce_currency(): string { return 'GHS'; }

if ( ! function_exists( 'sanitize_text_field' ) ) {
	function sanitize_text_field( $str ): string { return trim( strip_tags( (string) $str ) ); }
}
if ( ! function_exists( 'sanitize_title' ) ) {
	function sanitize_title( $str ): string {
		$s = strtolower( trim( (string) $str ) );
		$s = preg_replace( '/[^a-z0-9]+/', '-', $s );
		return trim( (string) $s, '-' );
	}
}
function wp_json_encode( $data ): string { return json_encode( $data ); }

class WP_Error {
	public function __construct(
		public string $code = '',
		public string $message = '',
		public mixed $data = null
	) {}
	public function get_error_code(): string { return $this->code; }
	public function get_error_message(): string { return $this->message; }
}

// ── ACF stubs (toggle presence by (un)defining these via globals) ──
function get_field_objects( $post_id ) {
	return $GLOBALS['_acf_fields'][ $post_id ] ?? [];
}
function get_field( $ref, $post_id ) {
	return $GLOBALS['_acf_values'][ $post_id ][ $ref ] ?? null;
}

// ── Minimal WC_Product stub ──
class WC_Product {
	public function __construct( private int $id = 1, private float $price = 100.0 ) {}
	public function get_id(): int { return $this->id; }
	public function get_price(): string { return number_format( $this->price, 2, '.', '' ); }
}

// ─────────────────────────────────────────────────────────────────
// Load code under test
// ─────────────────────────────────────────────────────────────────

require_once AGENTMESH_PLUGIN_DIR . 'includes/class-addons.php';

// ─────────────────────────────────────────────────────────────────
// Tiny assertion harness
// ─────────────────────────────────────────────────────────────────

$tests_passed = 0;
$tests_failed = 0;
$details      = [];

function ok( bool $cond, string $name ): void {
	global $tests_passed, $tests_failed, $details;
	if ( $cond ) { $tests_passed++; $details[] = "✓ $name"; }
	else { $tests_failed++; $details[] = "✗ $name"; }
}
function eq( $expected, $actual, string $name ): void {
	global $tests_passed, $tests_failed, $details;
	if ( $expected === $actual ) { $tests_passed++; $details[] = "✓ $name"; }
	else { $tests_failed++; $details[] = "✗ $name (expected " . var_export( $expected, true ) . ", got " . var_export( $actual, true ) . ")"; }
}

function reset_world(): void {
	global $_agentmesh_options;
	$_agentmesh_options = [ 'agentmesh_addons_enabled' => true ];
	$GLOBALS['_acf_fields'] = [];
	$GLOBALS['_acf_values'] = [];
}

/** Set the ACF field-objects map for product 1 and return a WC_Product. */
function with_fields( array $fields, array $values = [], float $price = 100.0 ): WC_Product {
	$GLOBALS['_acf_fields'][1] = $fields;
	$GLOBALS['_acf_values'][1] = $values;
	return new WC_Product( 1, $price );
}

/** Stub the merchant price map (agentmesh_addon_price_map option) for the world. */
function with_price_map( array $map ): void {
	global $_agentmesh_options;
	$_agentmesh_options['agentmesh_addon_price_map'] = json_encode( $map );
}

/** Find an addon by id in an extracted list. */
function addon( array $addons, string $id ): ?array {
	foreach ( $addons as $a ) { if ( $a['addon_id'] === $id ) return $a; }
	return null;
}

echo "Running ACF Product Add-ons Tests...\n";
echo "====================================\n\n";

// ─────────────────────────────────────────────────────────────────
// Type mapping
// ─────────────────────────────────────────────────────────────────
echo "extract_addons — type mapping:\n";

reset_world();
$product = with_fields( [
	'sel'  => [ 'name' => 'sel', 'key' => 'field_sel', 'label' => 'Pick one', 'type' => 'select', 'required' => 1, 'choices' => [ 'a' => 'Option A', 'b' => 'Option B' ] ],
	'msel' => [ 'name' => 'msel', 'key' => 'field_msel', 'label' => 'Multi', 'type' => 'select', 'multiple' => 1, 'choices' => [ 'x' => 'X', 'y' => 'Y' ] ],
	'rad'  => [ 'name' => 'rad', 'key' => 'field_rad', 'label' => 'Radio', 'type' => 'radio', 'choices' => [ 'r1' => 'R1' ] ],
	'bg'   => [ 'name' => 'bg', 'key' => 'field_bg', 'label' => 'BtnGroup', 'type' => 'button_group', 'choices' => [ 'g1' => 'G1' ] ],
	'chk'  => [ 'name' => 'chk', 'key' => 'field_chk', 'label' => 'Checks', 'type' => 'checkbox', 'choices' => [ 'c1' => 'C1', 'c2' => 'C2' ] ],
	'tf'   => [ 'name' => 'tf', 'key' => 'field_tf', 'label' => 'Gift wrap', 'type' => 'true_false' ],
	'txt'  => [ 'name' => 'txt', 'key' => 'field_txt', 'label' => 'Note', 'type' => 'text', 'instructions' => 'Up to 50 chars' ],
	'ta'   => [ 'name' => 'ta', 'key' => 'field_ta', 'label' => 'Message', 'type' => 'textarea' ],
	'em'   => [ 'name' => 'em', 'key' => 'field_em', 'label' => 'Email', 'type' => 'email' ],
	'num'  => [ 'name' => 'num', 'key' => 'field_num', 'label' => 'Qty', 'type' => 'number', 'min' => 1, 'max' => 10 ],
	'rng'  => [ 'name' => 'rng', 'key' => 'field_rng', 'label' => 'Range', 'type' => 'range', 'min' => 0, 'max' => 5 ],
	// Non-input types that MUST be skipped:
	'tab'  => [ 'name' => 'tab', 'key' => 'field_tab', 'label' => 'Tab', 'type' => 'tab' ],
	'img'  => [ 'name' => 'img', 'key' => 'field_img', 'label' => 'Image', 'type' => 'image' ],
	'grp'  => [ 'name' => 'grp', 'key' => 'field_grp', 'label' => 'Group', 'type' => 'group' ],
	'rel'  => [ 'name' => 'rel', 'key' => 'field_rel', 'label' => 'Related', 'type' => 'relationship' ],
] );
$addons = AgentMesh_Addons::extract_addons( $product );

eq( 'select', addon( $addons, 'sel' )['type'], 'select → select' );
eq( true, addon( $addons, 'sel' )['required'], 'select required flag carried' );
eq( 'checkbox', addon( $addons, 'msel' )['type'], 'select+multiple → checkbox' );
eq( true, addon( $addons, 'msel' )['multiple'], 'multi-select is multiple' );
eq( 'radio', addon( $addons, 'rad' )['type'], 'radio → radio' );
eq( 'radio', addon( $addons, 'bg' )['type'], 'button_group → radio' );
eq( 'checkbox', addon( $addons, 'chk' )['type'], 'checkbox → checkbox' );
eq( true, addon( $addons, 'chk' )['multiple'], 'checkbox is multiple' );
ok( null === addon( $addons, 'tf' ), 'true_false (no price) dropped as metadata' );
ok( null === addon( $addons, 'txt' ), 'text (no price) dropped as metadata' );
ok( null === addon( $addons, 'ta' ), 'textarea (no price) dropped as metadata' );
ok( null === addon( $addons, 'em' ), 'email (no price) dropped as metadata' );
ok( null === addon( $addons, 'num' ), 'number (no price) dropped as metadata' );
ok( null === addon( $addons, 'rng' ), 'range (no price) dropped as metadata' );
ok( null === addon( $addons, 'tab' ), 'tab skipped' );
ok( null === addon( $addons, 'img' ), 'image skipped' );
ok( null === addon( $addons, 'grp' ), 'group skipped' );
ok( null === addon( $addons, 'rel' ), 'relationship skipped' );
eq( 5, count( $addons ), 'only the 5 choice fields surface (free-form metadata dropped)' );

echo "\n";

// ─────────────────────────────────────────────────────────────────
// Buyer-facing classification: only choices or priced fields surface
// ─────────────────────────────────────────────────────────────────
echo "extract_addons — buyer-facing classification:\n";

// Pronto-like: vendor metadata (text/number, no price) dropped; priced choice kept.
reset_world();
$product = with_fields( [
	'grape_variety' => [ 'name' => 'grape_variety', 'key' => 'field_grape', 'label' => 'Grape Variety', 'type' => 'text' ],
	'alcohol'       => [ 'name' => 'alcohol', 'key' => 'field_alcohol', 'label' => 'Alcohol', 'type' => 'text' ],
	'non_price'     => [ 'name' => 'non_price', 'key' => 'field_np', 'label' => 'Non Price', 'type' => 'number' ],
	'qty'           => [ 'name' => 'qty', 'key' => 'field_qty', 'label' => 'Quantity', 'type' => 'checkbox', 'choices' => [ 'bottle' => 'Bottle', 'box' => 'Box' ] ],
] );
$addons = AgentMesh_Addons::extract_addons( $product );
eq( [ 'qty' ], array_values( array_column( $addons, 'addon_id' ) ), 'pronto: only the choice field surfaces' );

// Free choice (radio, no price) is still a buyer choice → kept.
reset_world();
$product = with_fields( [
	'flavour' => [ 'name' => 'flavour', 'key' => 'field_flav', 'label' => 'Flavour', 'type' => 'radio', 'choices' => [ 'vanilla' => 'Vanilla', 'chocolate' => 'Chocolate' ] ],
] );
$addons = AgentMesh_Addons::extract_addons( $product );
eq( 1, count( $addons ), 'free choice (radio, no price) kept' );

// Priced free-text (price-map entry) → kept.
reset_world();
with_price_map( [ 'engrave' => [ 'amount' => '5.00' ] ] );
$product = with_fields( [
	'engrave' => [ 'name' => 'engrave', 'key' => 'field_eng', 'label' => 'Engraving', 'type' => 'text' ],
] );
$addons = AgentMesh_Addons::extract_addons( $product );
eq( 1, count( $addons ), 'priced free-text (price_map entry) kept' );

// Plain metadata (free-form text + number, no price) → dropped entirely.
reset_world();
$product = with_fields( [
	'note' => [ 'name' => 'note', 'key' => 'field_note', 'label' => 'Note', 'type' => 'text' ],
	'qtyn' => [ 'name' => 'qtyn', 'key' => 'field_qtyn', 'label' => 'Qty', 'type' => 'number' ],
] );
$addons = AgentMesh_Addons::extract_addons( $product );
eq( 0, count( $addons ), 'plain free-form metadata dropped' );

echo "\n";

// ─────────────────────────────────────────────────────────────────
// Repeater → options with price subfield
// ─────────────────────────────────────────────────────────────────
echo "extract_addons — repeater:\n";

reset_world();
$product = with_fields( [
	'extras' => [
		'name' => 'extras', 'key' => 'field_extras', 'label' => 'Extras', 'type' => 'repeater', 'required' => 0,
		'sub_fields' => [
			[ 'name' => 'label', 'type' => 'text' ],
			[ 'name' => 'price', 'type' => 'number' ],
		],
		'value' => [
			[ 'label' => 'Extra Cheese', 'price' => 5 ],
			[ 'label' => 'Bacon', 'price' => 7.5 ],
			[ 'price' => 9 ], // no label → skipped (malformed/empty row)
		],
	],
] );
$addons  = AgentMesh_Addons::extract_addons( $product );
$rep     = addon( $addons, 'extras' );
eq( 'checkbox', $rep['type'], 'repeater → checkbox' );
eq( true, $rep['multiple'], 'repeater defaults multiple' );
eq( 2, count( $rep['options'] ), 'malformed (no label) row skipped' );
eq( 'Extra Cheese', $rep['options'][0]['label'], 'row label = first text subfield' );
eq( 'extra-cheese', $rep['options'][0]['value'], 'row value = slug of label' );
eq( '5.00', $rep['options'][0]['price_modifier']['amount'], 'repeater price subfield → modifier' );
eq( '7.50', $rep['options'][1]['price_modifier']['amount'], 'repeater price subfield (decimal)' );
eq( 'GHS', $rep['options'][0]['price_modifier']['currency'], 'modifier uses store currency' );

echo "\n";

// ─────────────────────────────────────────────────────────────────
// Hide-list filtering + ACF-absent (toggle)
// ─────────────────────────────────────────────────────────────────
echo "extract_addons — filtering & guards:\n";

reset_world();
$_agentmesh_options['agentmesh_addon_hidden_fields'] = 'secret, field_internal';
// Use choice fields so the hide-list (not buyer-facing classification) is what's exercised.
$product = with_fields( [
	'shown'    => [ 'name' => 'shown', 'key' => 'field_shown', 'label' => 'Shown', 'type' => 'radio', 'choices' => [ 'y' => 'Yes' ] ],
	'secret'   => [ 'name' => 'secret', 'key' => 'field_secret', 'label' => 'Secret', 'type' => 'radio', 'choices' => [ 'y' => 'Yes' ] ],
	'internal' => [ 'name' => 'internal', 'key' => 'field_internal', 'label' => 'Internal', 'type' => 'radio', 'choices' => [ 'y' => 'Yes' ] ],
] );
$addons = AgentMesh_Addons::extract_addons( $product );
eq( 1, count( $addons ), 'hide-list drops by name AND key' );
eq( 'shown', $addons[0]['addon_id'], 'only non-hidden field remains' );

reset_world();
$_agentmesh_options['agentmesh_addons_enabled'] = false;
$product = with_fields( [ 'a' => [ 'name' => 'a', 'type' => 'text', 'label' => 'A' ] ] );
eq( [], AgentMesh_Addons::extract_addons( $product ), 'master toggle off → []' );

echo "\n";

// ─────────────────────────────────────────────────────────────────
// Price map: fixed, per-option, referenced field
// ─────────────────────────────────────────────────────────────────
echo "Price resolution — price map:\n";

reset_world();
$_agentmesh_options['agentmesh_addon_price_map'] = json_encode( [
	'wrap'     => [ 'amount' => '3.00' ],
	'size'     => [ 'options' => [ 'lg' => '5.00', 'xl' => '8.00' ] ],
	'engraving'=> [ 'price_field' => 'field_engrave_price' ],
] );
$product = with_fields(
	[
		'wrap'     => [ 'name' => 'wrap', 'type' => 'true_false', 'label' => 'Gift wrap' ],
		'size'     => [ 'name' => 'size', 'type' => 'radio', 'label' => 'Size', 'choices' => [ 'sm' => 'Small', 'lg' => 'Large', 'xl' => 'XL' ] ],
		'engraving'=> [ 'name' => 'engraving', 'type' => 'select', 'label' => 'Engraving', 'choices' => [ 'yes' => 'Yes' ] ],
	],
	[ 'field_engrave_price' => 12 ]
);
$addons = AgentMesh_Addons::extract_addons( $product );
$size   = addon( $addons, 'size' );
$opt    = fn( $a, $v ) => current( array_filter( $a['options'], fn( $o ) => $o['value'] === $v ) );
ok( ! isset( $opt( $size, 'sm' )['price_modifier'] ), 'unmapped option = free' );
eq( '5.00', $opt( $size, 'lg' )['price_modifier']['amount'], 'per-option map (lg)' );
eq( '8.00', $opt( $size, 'xl' )['price_modifier']['amount'], 'per-option map (xl)' );
$eng = addon( $addons, 'engraving' );
eq( '12.00', $opt( $eng, 'yes' )['price_modifier']['amount'], 'referenced ACF price field resolved' );

echo "\n";

// ─────────────────────────────────────────────────────────────────
// (+N) / (-N) label parsing (zero-config fallback)
// ─────────────────────────────────────────────────────────────────
echo "Price resolution — label suffix:\n";

reset_world();
$product = with_fields( [
	'topping' => [ 'name' => 'topping', 'type' => 'radio', 'label' => 'Topping', 'choices' => [
		'plain'   => 'Plain',
		'cheese'  => 'Cheese (+2.50)',
		'premium' => 'Premium (+10)',
		'disc'    => 'Discounted (-1.00)',
	] ],
] );
$addons = AgentMesh_Addons::extract_addons( $product );
$top    = addon( $addons, 'topping' );
$optby  = fn( $a, $v ) => current( array_filter( $a['options'], fn( $o ) => $o['value'] === $v ) );
ok( ! isset( $optby( $top, 'plain' )['price_modifier'] ), 'no suffix → free' );
eq( '2.50', $optby( $top, 'cheese' )['price_modifier']['amount'], '(+2.50) parsed' );
eq( '10.00', $optby( $top, 'premium' )['price_modifier']['amount'], '(+10) parsed' );
eq( '-1.00', $optby( $top, 'disc' )['price_modifier']['amount'], '(-1.00) parsed' );

// price-map wins over label suffix
reset_world();
$_agentmesh_options['agentmesh_addon_price_map'] = json_encode( [ 'topping' => [ 'options' => [ 'cheese' => '1.00' ] ] ] );
$product = with_fields( [
	'topping' => [ 'name' => 'topping', 'type' => 'radio', 'label' => 'Topping', 'choices' => [ 'cheese' => 'Cheese (+2.50)' ] ],
] );
$top = addon( AgentMesh_Addons::extract_addons( $product ), 'topping' );
eq( '1.00', $top['options'][0]['price_modifier']['amount'], 'price map wins over (+N) label' );

echo "\n";

// ─────────────────────────────────────────────────────────────────
// validate_and_resolve_selection
// ─────────────────────────────────────────────────────────────────
echo "validate_and_resolve_selection:\n";

reset_world();
// qty/note are priced add-ons here (price_map keys) so they stay buyer-facing; number/text
// still resolve with no modifier, so the totals below are unaffected.
with_price_map( [ 'qty' => [ 'amount' => '0' ], 'note' => [ 'amount' => '0' ] ] );
$product = with_fields( [
	'size'  => [ 'name' => 'size', 'type' => 'radio', 'label' => 'Size', 'required' => 1, 'choices' => [ 'sm' => 'Small', 'lg' => 'Large (+5)' ] ],
	'addon' => [ 'name' => 'addon', 'type' => 'checkbox', 'label' => 'Extras', 'choices' => [ 'a' => 'A (+2)', 'b' => 'B (+3)' ] ],
	'qty'   => [ 'name' => 'qty', 'type' => 'number', 'label' => 'Qty', 'min' => 1, 'max' => 5 ],
	'note'  => [ 'name' => 'note', 'type' => 'text', 'label' => 'Note' ],
] );
$def = AgentMesh_Addons::extract_addons( $product );

// required missing
$res = AgentMesh_Addons::validate_and_resolve_selection( $def, [] );
ok( $res instanceof WP_Error, 'required missing → WP_Error' );
eq( 'ADDON_REQUIRED', $res->get_error_code(), 'code ADDON_REQUIRED' );

// invalid option
$res = AgentMesh_Addons::validate_and_resolve_selection( $def, [ 'size' => 'xxl' ] );
eq( 'ADDON_INVALID_OPTION', $res->get_error_code(), 'invalid select option → ADDON_INVALID_OPTION' );

// invalid checkbox member
$res = AgentMesh_Addons::validate_and_resolve_selection( $def, [ 'size' => 'sm', 'addon' => [ 'a', 'zzz' ] ] );
eq( 'ADDON_INVALID_OPTION', $res->get_error_code(), 'invalid checkbox member → ADDON_INVALID_OPTION' );

// out of range
$res = AgentMesh_Addons::validate_and_resolve_selection( $def, [ 'size' => 'sm', 'qty' => 99 ] );
eq( 'ADDON_OUT_OF_RANGE', $res->get_error_code(), 'number > max → ADDON_OUT_OF_RANGE' );

// unknown addon
$res = AgentMesh_Addons::validate_and_resolve_selection( $def, [ 'size' => 'sm', 'bogus' => 'x' ] );
eq( 'ADDON_UNKNOWN', $res->get_error_code(), 'unknown addon_id → ADDON_UNKNOWN' );

// valid selection + modifier math
$res = AgentMesh_Addons::validate_and_resolve_selection( $def, [ 'size' => 'lg', 'addon' => [ 'a', 'b' ], 'qty' => 3, 'note' => 'Hi' ] );
ok( is_array( $res ), 'valid selection returns array' );
eq( 10.0, $res['modifier_total'], 'modifier total = 5 + 2 + 3' );
eq( 4, count( $res['selected'] ), 'four selected add-ons resolved' );
$sel_by = fn( $r, $id ) => current( array_filter( $r['selected'], fn( $s ) => $s['addon_id'] === $id ) );
eq( 'lg', $sel_by( $res, 'size' )['value'], 'size value resolved' );
eq( '5.00', $sel_by( $res, 'size' )['price_modifier']['amount'], 'size modifier attached' );
eq( [ 'a', 'b' ], $sel_by( $res, 'addon' )['value'], 'checkbox values are an array' );
eq( '3', $sel_by( $res, 'qty' )['value'], 'number coerced to int-string' );
ok( ! isset( $sel_by( $res, 'qty' )['price_modifier'] ), 'number has no modifier' );
eq( 'Hi', $sel_by( $res, 'note' )['value'], 'text value sanitised + carried' );

// optional omitted → no line
$res = AgentMesh_Addons::validate_and_resolve_selection( $def, [ 'size' => 'sm' ] );
eq( 1, count( $res['selected'] ), 'optional omitted produces no line' );
eq( 0.0, $res['modifier_total'], 'no modifier for free required pick' );

echo "\n";

// ─────────────────────────────────────────────────────────────────
// addons_from_order_item
// ─────────────────────────────────────────────────────────────────
echo "addons_from_order_item:\n";

$fake_item = new class {
	public function get_meta( $key ) {
		return $key === '_agentmesh_addons'
			? json_encode( [ [ 'addon_id' => 'size', 'label' => 'Size', 'value' => 'lg' ] ] )
			: '';
	}
};
$round = AgentMesh_Addons::addons_from_order_item( $fake_item );
eq( 'size', $round[0]['addon_id'], 'order-item meta round-trips selected add-ons' );

$empty_item = new class {
	public function get_meta( $key ) { return ''; }
};
eq( [], AgentMesh_Addons::addons_from_order_item( $empty_item ), 'no meta → []' );

echo "\n";

// ─────────────────────────────────────────────────────────────────
// Grouped (nested) repeater — the sorella "Customise Your Cake" shape
// ─────────────────────────────────────────────────────────────────
echo "extract_addons — grouped (nested) repeater:\n";

reset_world();
$_agentmesh_options['agentmesh_addon_grouped_enabled'] = true;   // opt-in (default off)
$_agentmesh_options['agentmesh_addon_multi_groups'] = 'Cake Decorations';

$grouped_field = [
	'name'  => 'cake_options',
	'key'   => 'field_cake_options',
	'label' => 'Cake Options',
	'type'  => 'repeater',
	'sub_fields' => [
		[ 'name' => 'options_title', 'type' => 'text' ],
		[
			'name' => 'options_list',
			'type' => 'repeater',
			'sub_fields' => [
				[ 'name' => 'list_title', 'type' => 'text' ],
				[ 'name' => 'list_original_price', 'type' => 'number' ],
				[ 'name' => 'list_discounted_price', 'type' => 'text' ],
				[ 'name' => 'list_image', 'type' => 'image' ],
			],
		],
	],
	// ACF returns the actual rows in `value`.
	'value' => [
		[
			'options_title' => 'Cake Base',
			'options_list'  => [
				[ 'list_title' => 'Vanilla Sponge 6"', 'list_original_price' => 210, 'list_discounted_price' => '' ],
				[ 'list_title' => 'Chocolate Fudge 6"', 'list_original_price' => 369, 'list_discounted_price' => 350 ],
			],
		],
		[
			'options_title' => 'Cake Decorations',
			'options_list'  => [
				[ 'list_title' => 'Ribbons', 'list_original_price' => 50, 'list_discounted_price' => '' ],
				[ 'list_title' => 'Gold Leaf', 'list_original_price' => 80, 'list_discounted_price' => '' ],
			],
		],
	],
];

$product = with_fields( [ 'cake_options' => $grouped_field ], [], 10.0 );
$addons  = AgentMesh_Addons::extract_addons( $product );

eq( 2, count( $addons ), 'grouped repeater expands into one add-on per outer row' );
$base = addon( $addons, 'cake-base' );
$deco = addon( $addons, 'cake-decorations' );
eq( 'Cake Base', $base['label'] ?? null, 'group title becomes the add-on label' );
eq( 'radio', $base['type'] ?? null, 'default group is single-select (radio)' );
eq( false, $base['multiple'] ?? null, 'single-select group is not multiple' );
eq( 'checkbox', $deco['type'] ?? null, 'multi-group setting → checkbox' );
eq( true, $deco['multiple'] ?? null, 'multi-group is multiple' );
eq( 2, count( $base['options'] ), 'inner rows become options' );
eq( '210.00', $base['options'][0]['price_modifier']['amount'] ?? null, 'original price used when no discount' );
eq( '350.00', $base['options'][1]['price_modifier']['amount'] ?? null, 'discounted price wins when valid' );
eq( 'vanilla-sponge-6', $base['options'][0]['value'] ?? null, 'option value slugified from label' );

// Absolute pricing: line = sum of selected options (handled in cart; here verify the
// modifier resolution a cart would sum).
$res = AgentMesh_Addons::validate_and_resolve_selection( $addons, [ 'cake-base' => 'chocolate-fudge-6', 'cake-decorations' => [ 'ribbons', 'gold-leaf' ] ] );
eq( false, $res instanceof WP_Error, 'valid grouped selection resolves' );
eq( 480.0, (float) $res['modifier_total'], 'modifier total = 350 (base) + 50 + 80 decorations' );

// Opt-in gate: with grouped DISABLED (default), the same nested repeater does NOT expand —
// it falls through to the flat path unchanged (no surprise for stores that don't opt in).
$_agentmesh_options['agentmesh_addon_grouped_enabled'] = false;
$addons_off = AgentMesh_Addons::extract_addons( $product );
ok( null === addon( $addons_off, 'cake-base' ), 'grouped OFF (default) → no per-group expansion' );

echo "\n";

// ─────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────
echo "====================================\n";
echo "Test Results:\n";
echo "====================================\n";
foreach ( $details as $d ) { echo "$d\n"; }
echo "\nTotal: " . ( $tests_passed + $tests_failed ) . " tests\n";
echo "Passed: $tests_passed\n";
echo "Failed: $tests_failed\n";
echo "====================================\n";
if ( $tests_failed > 0 ) { exit( 1 ); }
echo "\n✓ All add-on tests passed!\n";
exit( 0 );
