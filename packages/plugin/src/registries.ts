import type {
  AuthProvider,
  AuthRegistry,
  Importer,
  ImporterRegistry,
  Middleware,
  MiddlewareRegistry,
  TransportAdapter,
  TransportRegistry,
} from "@mavio/sdk";

export class InMemoryImporterRegistry implements ImporterRegistry {
  private readonly items = new Map<string, Importer>();
  register(importer: Importer): void {
    this.items.set(importer.name, importer);
  }
  list(): Importer[] {
    return Array.from(this.items.values());
  }
  get(name: string): Importer | undefined {
    return this.items.get(name);
  }
}

export class InMemoryTransportRegistry implements TransportRegistry {
  private readonly items = new Map<string, TransportAdapter>();
  register(adapter: TransportAdapter): void {
    this.items.set(adapter.kind, adapter);
  }
  list(): TransportAdapter[] {
    return Array.from(this.items.values());
  }
  get(kind: string): TransportAdapter | undefined {
    return this.items.get(kind);
  }
}

export class InMemoryMiddlewareRegistry implements MiddlewareRegistry {
  private readonly items: Middleware[] = [];
  register(mw: Middleware): void {
    this.items.push(mw);
  }
  list(): Middleware[] {
    return [...this.items];
  }
}

export class InMemoryAuthRegistry implements AuthRegistry {
  private readonly items = new Map<string, AuthProvider>();
  register(provider: AuthProvider): void {
    this.items.set(provider.name, provider);
  }
  list(): AuthProvider[] {
    return Array.from(this.items.values());
  }
  get(name: string): AuthProvider | undefined {
    return this.items.get(name);
  }
}
