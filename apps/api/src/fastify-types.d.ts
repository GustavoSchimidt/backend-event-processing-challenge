import 'fastify';
import { AppServices } from './app-services';

declare module 'fastify' {
  interface FastifyInstance {
    services: AppServices;
  }
}
