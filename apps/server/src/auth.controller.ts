import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Put,
  UseGuards,
} from "@nestjs/common";
import { Actions } from "@mavio/rbac";
import { OidcProviderRepository, type OidcProvider } from "@mavio/registry";
import { ApiKeyGuard } from "./auth.guard.js";
import { RbacGuard, RequirePermission } from "./rbac.guard.js";
import { OIDC_PROVIDER_REPO } from "./auth.module.js";

interface UpsertProviderBody {
  displayName: string;
  issuerUrl: string;
  clientId: string;
  clientSecretRef: string;
  redirectUri: string;
  scopes?: string[];
  enabled?: boolean;
}

interface PublicProvider {
  id: string;
  displayName: string;
  loginUrl: string;
}

function toPublic(p: OidcProvider): PublicProvider {
  return { id: p.id, displayName: p.displayName, loginUrl: `/auth/${p.id}/login` };
}

@Controller()
export class AuthController {
  constructor(@Inject(OIDC_PROVIDER_REPO) private readonly repo: OidcProviderRepository) {}

  // Public: enabled providers only, no secrets.
  @Get("auth/providers")
  async listPublic(): Promise<PublicProvider[]> {
    const providers = await this.repo.list(false);
    return providers.map(toPublic);
  }

  // Admin CRUD.
  @Get("api/auth/providers")
  @UseGuards(ApiKeyGuard, RbacGuard)
  @RequirePermission(Actions.WorkspaceAdmin)
  listAll(): Promise<OidcProvider[]> {
    return this.repo.list(true);
  }

  @Get("api/auth/providers/:id")
  @UseGuards(ApiKeyGuard, RbacGuard)
  @RequirePermission(Actions.WorkspaceAdmin)
  get(@Param("id") id: string): Promise<OidcProvider> {
    return this.repo.get(id);
  }

  @Put("api/auth/providers/:id")
  @UseGuards(ApiKeyGuard, RbacGuard)
  @RequirePermission(Actions.WorkspaceAdmin)
  upsert(@Param("id") id: string, @Body() body: UpsertProviderBody): Promise<OidcProvider> {
    return this.repo.upsert({ id, ...body });
  }

  @Delete("api/auth/providers/:id")
  @UseGuards(ApiKeyGuard, RbacGuard)
  @RequirePermission(Actions.WorkspaceAdmin)
  @HttpCode(204)
  async delete(@Param("id") id: string): Promise<void> {
    await this.repo.delete(id);
  }
}
