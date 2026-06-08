import { HttpClient } from './http.js';
import { DiscoveryModule } from './modules/discovery.js';
import { ProductsModule } from './modules/products.js';
import { ReviewsModule } from './modules/reviews.js';
import { CartModule } from './modules/cart.js';
import { CheckoutModule } from './modules/checkout.js';
import { OrdersModule } from './modules/orders.js';
import { PaymentsModule } from './modules/payments.js';
import type { SynchronityConfig } from './config.js';

export { type SynchronityConfig };

export class Synchronity {
  readonly discovery: DiscoveryModule;
  readonly products: ProductsModule;
  readonly reviews: ReviewsModule;
  readonly cart: CartModule;
  readonly checkout: CheckoutModule;
  readonly orders: OrdersModule;
  readonly payments: PaymentsModule;

  constructor(config: SynchronityConfig) {
    const http = new HttpClient(config);
    this.discovery = new DiscoveryModule(http);
    this.products = new ProductsModule(http);
    this.reviews = new ReviewsModule(http);
    this.cart = new CartModule(http);
    this.checkout = new CheckoutModule(http);
    this.orders = new OrdersModule(http);
    this.payments = new PaymentsModule(http);
  }

  /** Construct an Synchronity client with a pre-built HttpClient (for testing). */
  static withHttpClient(config: SynchronityConfig, httpClient: HttpClient): Synchronity {
    const instance = Object.create(Synchronity.prototype) as Synchronity;
    (instance as { discovery: DiscoveryModule }).discovery = new DiscoveryModule(httpClient);
    (instance as { products: ProductsModule }).products = new ProductsModule(httpClient);
    (instance as { reviews: ReviewsModule }).reviews = new ReviewsModule(httpClient);
    (instance as { cart: CartModule }).cart = new CartModule(httpClient);
    (instance as { checkout: CheckoutModule }).checkout = new CheckoutModule(httpClient);
    (instance as { orders: OrdersModule }).orders = new OrdersModule(httpClient);
    (instance as { payments: PaymentsModule }).payments = new PaymentsModule(httpClient);
    return instance;
  }
}
