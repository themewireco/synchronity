#!/usr/bin/env php
<?php
/**
 * Regression test for the add-on undercharge bug: folding add-on price modifiers
 * into a line item must raise the ORDER total (what Paystack charges), not just a
 * detached DB copy. Reproduces WooCommerce's get_item($id, $load_from_db=true)
 * semantics with a faithful stub.  Run: php tests/run-checkout-pricing-tests.php
 */
error_reporting( E_ALL ); ini_set( 'display_errors', '1' );
define( 'ABSPATH', __DIR__ . '/' );
define( 'AGENTMESH_PLUGIN_DIR', dirname( __DIR__ ) . '/' );
function wp_json_encode( $d ) { return json_encode( $d ); }

// Settable option store so tests can toggle the add-on pricing mode.
$GLOBALS['_options'] = [];
function get_option( $key, $default = false ) { return $GLOBALS['_options'][ $key ] ?? $default; }

// --- Faithful WooCommerce stubs ---------------------------------------------

class Stub_Item {
	public float $subtotal = 0.0;
	public float $total = 0.0;
	public array $meta = [];
	public function set_subtotal( $v ) { $this->subtotal = (float) $v; }
	public function set_total( $v ) { $this->total = (float) $v; }
	public function get_total() { return $this->total; }
	public function get_subtotal() { return $this->subtotal; }
	public function add_meta_data( $k, $v, $unique = false ) { $this->meta[ $k ] = $v; }
	public function save() { /* DB persist — no-op; a detached clone's save does NOT touch the order collection */ }
}

class Stub_Product {
	private float $price;
	public function __construct( float $price ) { $this->price = $price; }
	public function get_price() { return $this->price; }
}

class Stub_Order {
	/** @var array<int,Stub_Item> in-memory item collection (what calculate_totals sums) */
	public array $items = [];
	private int $next = 100;
	public float $order_total = 0.0;

	public function add_product( $product, $quantity ) {
		$id = $this->next++;
		$it = new Stub_Item();
		$line = (float) $product->get_price() * (int) $quantity;
		$it->set_subtotal( $line );
		$it->set_total( $line );
		$this->items[ $id ] = $it;
		return $id;
	}

	/** Mirrors WC_Abstract_Order::get_item($id, $load_from_db = true): true => detached DB copy. */
	public function get_item( $id, $load_from_db = true ) {
		if ( ! isset( $this->items[ $id ] ) ) { return false; }
		return $load_from_db ? clone $this->items[ $id ] : $this->items[ $id ];
	}

	/** Sums the in-memory item collection — like WC. */
	public function calculate_totals() {
		$t = 0.0;
		foreach ( $this->items as $it ) { $t += $it->get_total(); }
		$this->order_total = $t;
	}
	public function get_total() { return $this->order_total; }
}

require_once AGENTMESH_PLUGIN_DIR . 'includes/class-checkout.php';

$pass = 0; $fail = 0;
function eq( $exp, $act, $name ) { global $pass, $fail; if ( abs( (float) $exp - (float) $act ) < 0.001 ) { $pass++; echo "✓ $name\n"; } else { $fail++; echo "✗ $name (exp $exp got $act)\n"; } }

// base 10 + addon modifiers (420+80+120+115+170 = 905) × qty 1 → line 915; order total must be 915.
$order   = new Stub_Order();
$product = new Stub_Product( 10.0 );
$item_id = $order->add_product( $product, 1 );
$addons  = [
	[ 'addon_id' => 'size', 'label' => 'Size', 'value' => '6-round' ],
	[ 'addon_id' => 'base', 'label' => 'Base', 'value' => 'vanilla', 'price_modifier' => [ 'amount' => '420.00', 'currency' => 'GHS' ] ],
	[ 'addon_id' => 'fill', 'label' => 'Filling', 'value' => 'dulce', 'price_modifier' => [ 'amount' => '80.00', 'currency' => 'GHS' ] ],
	[ 'addon_id' => 'butter', 'label' => 'Buttercream', 'value' => 'vanilla', 'price_modifier' => [ 'amount' => '120.00', 'currency' => 'GHS' ] ],
	[ 'addon_id' => 'top', 'label' => 'Topping', 'value' => [ 'a', 'b', 'c' ], 'price_modifier' => [ 'amount' => '115.00', 'currency' => 'GHS' ] ],
	[ 'addon_id' => 'deco', 'label' => 'Decorations', 'value' => [ 'x', 'y' ], 'price_modifier' => [ 'amount' => '170.00', 'currency' => 'GHS' ] ],
];

$m = new ReflectionMethod( 'AgentMesh_Checkout', 'fold_addons_into_line' );
$m->invoke( null, $order, $item_id, $product, 1, $addons );

$order->calculate_totals();
eq( 915.0, $order->get_total(), 'additive mode: order total = base + add-on surcharges' );
eq( 915.0, $order->items[ $item_id ]->get_total(), 'additive mode: in-memory line carries base + surcharge' );

// --- Absolute mode: line price = SUM of selected option prices, base ignored ---
// Same add-ons (905 total), base 10, qty 2 → absolute line/order total must be 905×2 = 1810
// (NOT (10+905)×2 = 1830). Mirrors the cart's absolute-pricing rule.
$GLOBALS['_options']['agentmesh_addon_pricing_mode'] = 'absolute';
$order2   = new Stub_Order();
$product2 = new Stub_Product( 10.0 );
$item_id2 = $order2->add_product( $product2, 2 );
$m->invoke( null, $order2, $item_id2, $product2, 2, $addons );
$order2->calculate_totals();
eq( 1810.0, $order2->get_total(), 'absolute mode: order total = sum of option prices × qty (base ignored)' );
eq( 1810.0, $order2->items[ $item_id2 ]->get_total(), 'absolute mode: in-memory line = option sum × qty' );

echo "\nTotal: " . ( $pass + $fail ) . " Passed: $pass Failed: $fail\n";
exit( $fail ? 1 : 0 );
