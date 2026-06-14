<?php
/**
 * Tests for AgentMesh_IP_Validator
 */

class AgentMesh_IP_Validator_Tests extends WP_UnitTestCase {

	/**
	 * Test is_llm_request detects Claude IPs correctly.
	 */
	public function test_is_llm_request_claude_ip() {
		// Mock $_SERVER to simulate Claude IP
		$_SERVER['REMOTE_ADDR'] = '54.191.123.45';
		$result                  = AgentMesh_IP_Validator::is_llm_request();
		$this->assertTrue( $result, 'Should detect Claude IP 54.191.123.45' );

		// Another Claude range
		$_SERVER['REMOTE_ADDR'] = '52.100.200.50';
		$result                  = AgentMesh_IP_Validator::is_llm_request();
		$this->assertTrue( $result, 'Should detect Claude IP 52.100.200.50 (52.0.0.0/8)' );
	}

	/**
	 * Test is_llm_request detects ChatGPT IPs correctly.
	 */
	public function test_is_llm_request_chatgpt_ip() {
		// Mock $_SERVER to simulate ChatGPT IP
		$_SERVER['REMOTE_ADDR'] = '34.208.100.50';
		$result                  = AgentMesh_IP_Validator::is_llm_request();
		$this->assertTrue( $result, 'Should detect ChatGPT IP in 34.208.0.0/12' );
	}

	/**
	 * Test is_llm_request detects Perplexity IPs correctly.
	 */
	public function test_is_llm_request_perplexity_ip() {
		// Mock $_SERVER to simulate Perplexity IP
		$_SERVER['REMOTE_ADDR'] = '206.189.50.100';
		$result                  = AgentMesh_IP_Validator::is_llm_request();
		$this->assertTrue( $result, 'Should detect Perplexity IP in 206.189.0.0/16' );
	}

	/**
	 * Test is_llm_request detects Gemini IPs correctly.
	 */
	public function test_is_llm_request_gemini_ip() {
		// Mock $_SERVER to simulate Gemini IP (Google Cloud)
		$_SERVER['REMOTE_ADDR'] = '34.64.200.50';
		$result                  = AgentMesh_IP_Validator::is_llm_request();
		$this->assertTrue( $result, 'Should detect Gemini IP in 34.64.0.0/10' );
	}

	/**
	 * Test is_llm_request rejects non-LLM IPs.
	 */
	public function test_is_llm_request_rejects_random_ip() {
		// Mock $_SERVER with random IP
		$_SERVER['REMOTE_ADDR'] = '192.168.1.1';
		$result                  = AgentMesh_IP_Validator::is_llm_request();
		$this->assertFalse( $result, 'Should reject random private IP' );

		$_SERVER['REMOTE_ADDR'] = '8.8.8.8';
		$result                  = AgentMesh_IP_Validator::is_llm_request();
		$this->assertFalse( $result, 'Should reject Google DNS IP' );

		$_SERVER['REMOTE_ADDR'] = '1.2.3.4';
		$result                  = AgentMesh_IP_Validator::is_llm_request();
		$this->assertFalse( $result, 'Should reject random IP' );
	}

	/**
	 * Test get_detected_llm returns correct provider.
	 */
	public function test_get_detected_llm_claude() {
		$_SERVER['REMOTE_ADDR'] = '54.191.123.45';
		$provider               = AgentMesh_IP_Validator::get_detected_llm();
		$this->assertEquals( 'claude', $provider, 'Should detect Claude' );
	}

	/**
	 * Test get_detected_llm returns correct provider for ChatGPT.
	 */
	public function test_get_detected_llm_chatgpt() {
		$_SERVER['REMOTE_ADDR'] = '34.208.100.50';
		$provider               = AgentMesh_IP_Validator::get_detected_llm();
		$this->assertEquals( 'chatgpt', $provider, 'Should detect ChatGPT' );
	}

	/**
	 * Test get_detected_llm returns null for non-LLM IPs.
	 */
	public function test_get_detected_llm_unknown() {
		$_SERVER['REMOTE_ADDR'] = '192.168.1.1';
		$provider               = AgentMesh_IP_Validator::get_detected_llm();
		$this->assertNull( $provider, 'Should return null for non-LLM IP' );
	}

	/**
	 * Test X-Forwarded-For header is read correctly.
	 */
	public function test_get_client_ip_x_forwarded_for() {
		unset( $_SERVER['REMOTE_ADDR'] );
		$_SERVER['HTTP_X_FORWARDED_FOR'] = '54.191.123.45, 10.0.0.1, 172.16.0.1';

		$result = AgentMesh_IP_Validator::is_llm_request();
		$this->assertTrue( $result, 'Should use first IP from X-Forwarded-For' );
	}

	/**
	 * Test X-Real-IP header is read correctly.
	 */
	public function test_get_client_ip_x_real_ip() {
		unset( $_SERVER['REMOTE_ADDR'] );
		unset( $_SERVER['HTTP_X_FORWARDED_FOR'] );
		$_SERVER['HTTP_X_REAL_IP'] = '206.189.50.100';

		$result = AgentMesh_IP_Validator::is_llm_request();
		$this->assertTrue( $result, 'Should use X-Real-IP header' );
	}

	/**
	 * Test HTTP_CLIENT_IP header is read correctly.
	 */
	public function test_get_client_ip_http_client_ip() {
		unset( $_SERVER['REMOTE_ADDR'] );
		unset( $_SERVER['HTTP_X_FORWARDED_FOR'] );
		unset( $_SERVER['HTTP_X_REAL_IP'] );
		$_SERVER['HTTP_CLIENT_IP'] = '34.64.200.50';

		$result = AgentMesh_IP_Validator::is_llm_request();
		$this->assertTrue( $result, 'Should use HTTP_CLIENT_IP header' );
	}

	/**
	 * Test CIDR range calculation for /16.
	 */
	public function test_cidr_calculation_16() {
		// 54.191.0.0/16 should include 54.191.0.0 to 54.191.255.255
		$_SERVER['REMOTE_ADDR'] = '54.191.0.0';
		$this->assertTrue( AgentMesh_IP_Validator::is_llm_request() );

		$_SERVER['REMOTE_ADDR'] = '54.191.255.255';
		$this->assertTrue( AgentMesh_IP_Validator::is_llm_request() );

		$_SERVER['REMOTE_ADDR'] = '54.190.255.255'; // Just outside
		$this->assertFalse( AgentMesh_IP_Validator::is_llm_request() );

		$_SERVER['REMOTE_ADDR'] = '54.192.0.0'; // Just outside
		$this->assertFalse( AgentMesh_IP_Validator::is_llm_request() );
	}

	/**
	 * Test CIDR range calculation for /24.
	 */
	public function test_cidr_calculation_24() {
		// 205.239.209.0/24 should include 205.239.209.0 to 205.239.209.255
		$_SERVER['REMOTE_ADDR'] = '205.239.209.0';
		$this->assertTrue( AgentMesh_IP_Validator::is_llm_request() );

		$_SERVER['REMOTE_ADDR'] = '205.239.209.255';
		$this->assertTrue( AgentMesh_IP_Validator::is_llm_request() );

		$_SERVER['REMOTE_ADDR'] = '205.239.208.255'; // Just outside
		$this->assertFalse( AgentMesh_IP_Validator::is_llm_request() );

		$_SERVER['REMOTE_ADDR'] = '205.239.210.0'; // Just outside
		$this->assertFalse( AgentMesh_IP_Validator::is_llm_request() );
	}

	/**
	 * Test CIDR range calculation for /8.
	 */
	public function test_cidr_calculation_8() {
		// 52.0.0.0/8 should include 52.0.0.0 to 52.255.255.255
		$_SERVER['REMOTE_ADDR'] = '52.0.0.0';
		$this->assertTrue( AgentMesh_IP_Validator::is_llm_request() );

		$_SERVER['REMOTE_ADDR'] = '52.255.255.255';
		$this->assertTrue( AgentMesh_IP_Validator::is_llm_request() );

		$_SERVER['REMOTE_ADDR'] = '51.255.255.255'; // Just outside
		$this->assertFalse( AgentMesh_IP_Validator::is_llm_request() );

		$_SERVER['REMOTE_ADDR'] = '53.0.0.0'; // Just outside
		$this->assertFalse( AgentMesh_IP_Validator::is_llm_request() );
	}

	/**
	 * Test CIDR range calculation for /10.
	 */
	public function test_cidr_calculation_10() {
		// 34.64.0.0/10 should include 34.64.0.0 to 34.127.255.255
		$_SERVER['REMOTE_ADDR'] = '34.64.0.0';
		$this->assertTrue( AgentMesh_IP_Validator::is_llm_request() );

		$_SERVER['REMOTE_ADDR'] = '34.127.255.255';
		$this->assertTrue( AgentMesh_IP_Validator::is_llm_request() );

		$_SERVER['REMOTE_ADDR'] = '34.63.255.255'; // Just outside
		$this->assertFalse( AgentMesh_IP_Validator::is_llm_request() );

		$_SERVER['REMOTE_ADDR'] = '34.128.0.0'; // Just outside
		$this->assertFalse( AgentMesh_IP_Validator::is_llm_request() );
	}

	/**
	 * Test CIDR range calculation for /12.
	 */
	public function test_cidr_calculation_12() {
		// 34.208.0.0/12 should include 34.208.0.0 to 34.223.255.255
		$_SERVER['REMOTE_ADDR'] = '34.208.0.0';
		$this->assertTrue( AgentMesh_IP_Validator::is_llm_request() );

		$_SERVER['REMOTE_ADDR'] = '34.223.255.255';
		$this->assertTrue( AgentMesh_IP_Validator::is_llm_request() );

		$_SERVER['REMOTE_ADDR'] = '34.207.255.255'; // Just outside
		$this->assertFalse( AgentMesh_IP_Validator::is_llm_request() );

		$_SERVER['REMOTE_ADDR'] = '34.224.0.0'; // Just outside
		$this->assertFalse( AgentMesh_IP_Validator::is_llm_request() );
	}

	/**
	 * Teardown after each test.
	 */
	public function tearDown(): void {
		parent::tearDown();
		unset( $_SERVER['REMOTE_ADDR'] );
		unset( $_SERVER['HTTP_X_FORWARDED_FOR'] );
		unset( $_SERVER['HTTP_X_REAL_IP'] );
		unset( $_SERVER['HTTP_CLIENT_IP'] );
	}
}
