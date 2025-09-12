import 'fastify';

declare module 'fastify' {
  export interface FastifyRequest {
    user?: {
      id: string;
      username: string;
      iat: number;
      exp: number;
    };
  }
}
