import type { HttpClient } from '../http.js';
import type {
  MobileMoneyProvider,
  PaymentChannel,
  PaymentMethodsResponse,
  PaymentSession,
} from '../types/amps.js';

export interface InitiatePaymentParams {
  channel: PaymentChannel;
  /** Required for mobile_money. */
  phone?: string;
  /** Required for mobile_money. */
  provider?: MobileMoneyProvider;
  /** Human delegation token; alternatively sent via the Authorization Bearer. */
  buyer_delegation_token?: string;
}

export interface SubmitOtpParams {
  otp: string;
  /** Human delegation token; alternatively sent via the Authorization Bearer. */
  buyer_delegation_token?: string;
}

export class PaymentsModule {
  constructor(private readonly http: HttpClient) {}

  /** GET available payment channels for an order. */
  async getMethods(siteId: string, orderId: string): Promise<PaymentMethodsResponse> {
    return this.http.get<PaymentMethodsResponse>(
      `/v1/sites/${siteId}/orders/${orderId}/payment/methods`,
    );
  }

  /** POST to initiate a payment session (requires delegation). */
  async initiate(
    siteId: string,
    orderId: string,
    params: InitiatePaymentParams,
  ): Promise<PaymentSession> {
    return this.http.post<PaymentSession>(
      `/v1/sites/${siteId}/orders/${orderId}/payment/initiate`,
      {
        channel: params.channel,
        ...(params.phone !== undefined && { phone: params.phone }),
        ...(params.provider !== undefined && { provider: params.provider }),
        ...(params.buyer_delegation_token !== undefined && {
          buyer_delegation_token: params.buyer_delegation_token,
        }),
      },
    );
  }

  /** POST an OTP for mobile-money flows that returned action `submit_otp` (requires delegation). */
  async submitOtp(
    siteId: string,
    orderId: string,
    params: SubmitOtpParams,
  ): Promise<PaymentSession> {
    return this.http.post<PaymentSession>(
      `/v1/sites/${siteId}/orders/${orderId}/payment/submit-otp`,
      {
        otp: params.otp,
        ...(params.buyer_delegation_token !== undefined && {
          buyer_delegation_token: params.buyer_delegation_token,
        }),
      },
    );
  }

  /** GET the current payment status; poll until paid/processing or failed. */
  async getStatus(siteId: string, orderId: string): Promise<PaymentSession> {
    return this.http.get<PaymentSession>(
      `/v1/sites/${siteId}/orders/${orderId}/payment/status`,
    );
  }
}
