import "server-only";
import {
  CampaignRepository,
  CampaignPreparationRepository,
  CampaignFinalizationRepository,
  CompanionRepository,
  ConversationAssistantRepository,
  ConversationComposerRepository,
  ConversationRepository,
  AiRepository,
  createDatabaseClient,
  DraftRepository,
  MarketMeRepository,
  ProfileRepository,
  PublishingRepository,
  RelationshipRepository,
} from "@market-me/database";
import { getServerConfiguration } from "./config";

const databaseGlobal = globalThis as typeof globalThis & {
  marketMeDatabase?: {
    core: MarketMeRepository;
    campaigns: CampaignRepository;
    preparations: CampaignPreparationRepository;
    finalizations: CampaignFinalizationRepository;
    publishing: PublishingRepository;
    companion: CompanionRepository;
    profiles: ProfileRepository;
    drafts: DraftRepository;
    relationships: RelationshipRepository;
    conversations: ConversationRepository;
    conversationAssistant: ConversationAssistantRepository;
    conversationComposer: ConversationComposerRepository;
    ai: AiRepository;
  };
};

export class DatabaseUnavailableError extends Error {
  constructor() {
    super(
      "Market Me persistence is not configured. Set DATABASE_URL and run the migrations.",
    );
    this.name = "DatabaseUnavailableError";
  }
}

export function getRepository(): MarketMeRepository {
  return getRepositories().core;
}

export function getCampaignRepository(): CampaignRepository {
  return getRepositories().campaigns;
}

export function getCampaignPreparationRepository(): CampaignPreparationRepository {
  return getRepositories().preparations;
}

export function getCampaignFinalizationRepository(): CampaignFinalizationRepository {
  return getRepositories().finalizations;
}

export function getPublishingRepository(): PublishingRepository {
  return getRepositories().publishing;
}

export function getCompanionRepository(): CompanionRepository {
  return getRepositories().companion;
}

export function getProfileRepository(): ProfileRepository {
  return getRepositories().profiles;
}

export function getDraftRepository(): DraftRepository {
  return getRepositories().drafts;
}

export function getRelationshipRepository(): RelationshipRepository {
  return getRepositories().relationships;
}

export function getConversationRepository(): ConversationRepository {
  return getRepositories().conversations;
}

export function getConversationAssistantRepository(): ConversationAssistantRepository {
  return getRepositories().conversationAssistant;
}

export function getConversationComposerRepository(): ConversationComposerRepository {
  return getRepositories().conversationComposer;
}

export function getAiRepository(): AiRepository {
  return getRepositories().ai;
}

function getRepositories(): {
  core: MarketMeRepository;
  campaigns: CampaignRepository;
  preparations: CampaignPreparationRepository;
  finalizations: CampaignFinalizationRepository;
  publishing: PublishingRepository;
  companion: CompanionRepository;
  profiles: ProfileRepository;
  drafts: DraftRepository;
  relationships: RelationshipRepository;
  conversations: ConversationRepository;
  conversationAssistant: ConversationAssistantRepository;
  conversationComposer: ConversationComposerRepository;
  ai: AiRepository;
} {
  if (databaseGlobal.marketMeDatabase) return databaseGlobal.marketMeDatabase;
  const databaseUrl = getServerConfiguration().databaseUrl;
  if (!databaseUrl) throw new DatabaseUnavailableError();
  const sql = createDatabaseClient(databaseUrl);
  const repositories = {
    core: new MarketMeRepository(sql),
    campaigns: new CampaignRepository(sql, { appBaseUrl: process.env.APP_BASE_URL }),
    preparations: new CampaignPreparationRepository(sql),
    finalizations: new CampaignFinalizationRepository(sql, { appBaseUrl: process.env.APP_BASE_URL }),
    publishing: new PublishingRepository(sql, { appBaseUrl: process.env.APP_BASE_URL }),
    companion: new CompanionRepository(sql),
    profiles: new ProfileRepository(sql),
    drafts: new DraftRepository(sql),
    relationships: new RelationshipRepository(sql),
    conversations: new ConversationRepository(sql),
    conversationAssistant: new ConversationAssistantRepository(sql),
    conversationComposer: new ConversationComposerRepository(sql),
    ai: new AiRepository(sql),
  };
  if (process.env.NODE_ENV !== "production")
    databaseGlobal.marketMeDatabase = repositories;
  return repositories;
}
