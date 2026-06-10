<?php
/**
 * Main plugin class — bootstraps all sub-components and registers REST routes.
 */

defined( 'ABSPATH' ) || exit;

class AgentMesh_Plugin {

	private static ?AgentMesh_Plugin $instance = null;

	public static function get_instance(): self {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	private function __construct() {}

	public function init(): void {
		$this->load_dependencies();
		$this->init_hooks();
	}

	private function load_dependencies(): void {
		require_once AGENTMESH_PLUGIN_DIR . 'includes/class-ip-validator.php';
		require_once AGENTMESH_PLUGIN_DIR . 'includes/class-auth.php';
		require_once AGENTMESH_PLUGIN_DIR . 'includes/class-addons.php';
		require_once AGENTMESH_PLUGIN_DIR . 'includes/class-normaliser.php';
		require_once AGENTMESH_PLUGIN_DIR . 'includes/class-review-normaliser.php';
		require_once AGENTMESH_PLUGIN_DIR . 'includes/class-reviews.php';
		require_once AGENTMESH_PLUGIN_DIR . 'includes/class-manifest.php';
		require_once AGENTMESH_PLUGIN_DIR . 'includes/class-products.php';
		require_once AGENTMESH_PLUGIN_DIR . 'includes/class-cart.php';
		require_once AGENTMESH_PLUGIN_DIR . 'includes/class-checkout.php';
		require_once AGENTMESH_PLUGIN_DIR . 'includes/class-payment-webhook.php';
		require_once AGENTMESH_PLUGIN_DIR . 'includes/class-payments.php';
		require_once AGENTMESH_PLUGIN_DIR . 'includes/class-orders.php';
		require_once AGENTMESH_PLUGIN_DIR . 'includes/class-webhooks.php';
		require_once AGENTMESH_PLUGIN_DIR . 'includes/class-reviews-endpoint.php';
		require_once AGENTMESH_PLUGIN_DIR . 'includes/class-schema-injector.php';

		if ( is_admin() ) {
			require_once AGENTMESH_PLUGIN_DIR . 'admin/class-settings.php';
			new AgentMesh_Settings();
		}
	}

	private function init_hooks(): void {
		add_action( 'rest_api_init', [ $this, 'register_routes' ] );
		add_action( 'init', [ $this, 'init_webhooks' ] );
		add_action( 'init', [ $this, 'init_schema_injector' ] );
		// The per-add-on selections render as readable line-item meta; the raw
		// _agentmesh_addons JSON blob is machine-only round-trip data — hide it
		// from the admin order screen so it doesn't clutter the item.
		add_filter( 'woocommerce_hidden_order_itemmeta', [ $this, 'hide_addon_blob_meta' ] );
	}

	/** Keep the machine-only _agentmesh_addons item meta out of the admin order UI. */
	public function hide_addon_blob_meta( array $keys ): array {
		$keys[] = '_agentmesh_addons';
		return $keys;
	}

	public function init_schema_injector(): void {
		if ( get_option( 'agentmesh_schema_injection_enabled', true ) ) {
			( new AgentMesh_Schema_Injector() )->init();
		}
	}

	public function register_routes(): void {
		if ( ! get_option( 'agentmesh_enabled', true ) ) {
			return;
		}

		( new AgentMesh_Manifest() )->register_routes();
		( new AgentMesh_Products() )->register_routes();
		( new AgentMesh_Cart() )->register_routes();
		( new AgentMesh_Checkout() )->register_routes();
		( new AgentMesh_Payment_Webhook() )->register_routes();
		( new AgentMesh_Payments() )->register_routes();
		( new AgentMesh_Orders() )->register_routes();
		( new AgentMesh_Reviews_Endpoint() )->register_routes();
	}

	public function init_webhooks(): void {
		if ( get_option( 'agentmesh_enabled', true ) ) {
			( new AgentMesh_Webhooks() )->register_hooks();
		}
	}
}
