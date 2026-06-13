-- Ajout des modèles DAO (Dossier d'Appel d'Offres) pour le module Relation Publique

CREATE TABLE IF NOT EXISTS `BidFolder` (
  `id` VARCHAR(191) NOT NULL,
  `reference` VARCHAR(191) NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `clientName` VARCHAR(191) NOT NULL DEFAULT '',
  `deadline` DATETIME(3) NULL,
  `estimatedAmount` DOUBLE NULL,
  `currency` VARCHAR(191) NOT NULL DEFAULT 'CDF',
  `status` VARCHAR(191) NOT NULL DEFAULT 'IN_PROGRESS',
  `notes` TEXT NULL,
  `createdById` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `BidFolder_reference_key` (`reference`),
  KEY `BidFolder_createdById_idx` (`createdById`),
  KEY `BidFolder_status_idx` (`status`)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `BidRequirement` (
  `id` VARCHAR(191) NOT NULL,
  `bidFolderId` VARCHAR(191) NOT NULL,
  `label` VARCHAR(191) NOT NULL,
  `description` TEXT NULL,
  `category` VARCHAR(191) NOT NULL DEFAULT 'AUTRE',
  `isRequired` TINYINT(1) NOT NULL DEFAULT 1,
  `orderIndex` INT NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `BidRequirement_bidFolderId_idx` (`bidFolderId`),
  CONSTRAINT `BidRequirement_bidFolderId_fkey` FOREIGN KEY (`bidFolderId`) REFERENCES `BidFolder` (`id`) ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `BidDocument` (
  `id` VARCHAR(191) NOT NULL,
  `bidFolderId` VARCHAR(191) NOT NULL,
  `requirementId` VARCHAR(191) NULL,
  `label` VARCHAR(191) NOT NULL,
  `originalFileName` VARCHAR(191) NOT NULL,
  `mimeType` VARCHAR(191) NOT NULL,
  `fileSize` INT NOT NULL DEFAULT 0,
  `fileData` LONGBLOB NULL,
  `externalUrl` VARCHAR(191) NULL,
  `uploadedById` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `BidDocument_bidFolderId_idx` (`bidFolderId`),
  KEY `BidDocument_requirementId_idx` (`requirementId`),
  KEY `BidDocument_uploadedById_idx` (`uploadedById`),
  CONSTRAINT `BidDocument_bidFolderId_fkey` FOREIGN KEY (`bidFolderId`) REFERENCES `BidFolder` (`id`) ON DELETE CASCADE,
  CONSTRAINT `BidDocument_requirementId_fkey` FOREIGN KEY (`requirementId`) REFERENCES `BidRequirement` (`id`) ON DELETE SET NULL,
  CONSTRAINT `BidDocument_uploadedById_fkey` FOREIGN KEY (`uploadedById`) REFERENCES `User` (`id`) ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
