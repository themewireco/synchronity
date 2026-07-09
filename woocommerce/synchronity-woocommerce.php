<?php
/**
 * Plugin Name: Synchronity for WooCommerce
 * Plugin URI: https://synchronity.app
 * Description: Connect your WooCommerce store to the Synchronity network — enabling AI agents to discover, search, and purchase from your store.
 * Version: 0.4.7
 * Author: Themewire Ltd
 * Author URI: https://themewire.co
 * License: Proprietary
 * Requires at least: 6.0
 * Requires PHP: 8.2
 * WC requires at least: 7.0
 * WC tested up to: 9.0
 */

defined( 'ABSPATH' ) || exit;

define( 'AGENTMESH_VERSION', '0.4.7' );
define( 'AGENTMESH_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'AGENTMESH_PLUGIN_URL', plugin_dir_url( __FILE__ ) );
define( 'AGENTMESH_REST_NAMESPACE', 'agentmesh/v1' );

/**
 * Check WooCommerce is active before loading the plugin.
 */
function agentmesh_check_dependencies(): void {
	if ( ! class_exists( 'WooCommerce' ) ) {
		add_action( 'admin_notices', function () {
			echo '<div class="notice notice-error"><p>'
				. esc_html__( 'Synchronity for WooCommerce requires WooCommerce to be installed and active.', 'agentmesh-woocommerce' )
				. '</p></div>';
		} );
		return;
	}

	require_once AGENTMESH_PLUGIN_DIR . 'includes/class-agentmesh-plugin.php';
	AgentMesh_Plugin::get_instance()->init();
}
add_action( 'plugins_loaded', 'agentmesh_check_dependencies' );

/**
 * Declare HPOS compatibility.
 */
add_action( 'before_woocommerce_init', function () {
	if ( class_exists( \Automattic\WooCommerce\Utilities\FeaturesUtil::class ) ) {
		\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'custom_order_tables', __FILE__, true );
	}
} );
