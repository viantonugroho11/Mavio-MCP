import { Global, Module } from "@nestjs/common";
import { loadConfig, type MavioConfig } from "@mavio/config";

export const MAVIO_CONFIG = Symbol("MAVIO_CONFIG");

@Global()
@Module({
  providers: [
    {
      provide: MAVIO_CONFIG,
      useFactory: async (): Promise<MavioConfig> => {
        const path = process.env.MAVIO_CONFIG_PATH ?? "./mavio.config.yaml";
        return loadConfig(path);
      },
    },
  ],
  exports: [MAVIO_CONFIG],
})
export class AppConfigModule {}
