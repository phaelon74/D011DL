import '@fastify/jwt'

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { 
      id: string;
      username: string;
    }
    user: {
      id: string;
      username: string;
      iat: number;
      exp: number;
    }
  }
}
