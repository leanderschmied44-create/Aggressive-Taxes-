import { world, system } from "@minecraft/server";

// Priority item identifiers
const DIAMOND_ITEMS = [
  "minecraft:diamond",
  "minecraft:diamond_block",
  "minecraft:diamond_ore",
  "minecraft:deepslate_diamond_ore",
  "minecraft:diamond_sword",
  "minecraft:diamond_pickaxe",
  "minecraft:diamond_axe",
  "minecraft:diamond_shovel",
  "minecraft:diamond_hoe",
  "minecraft:diamond_helmet",
  "minecraft:diamond_chestplate",
  "minecraft:diamond_leggings",
  "minecraft:diamond_boots",
  "minecraft:diamond_horse_armor"
];

const NETHERITE_ITEMS = [
  "minecraft:netherite_ingot",
  "minecraft:netherite_scrap",
  "minecraft:netherite_block",
  "minecraft:ancient_debris",
  "minecraft:netherite_sword",
  "minecraft:netherite_pickaxe",
  "minecraft:netherite_axe",
  "minecraft:netherite_shovel",
  "minecraft:netherite_hoe",
  "minecraft:netherite_helmet",
  "minecraft:netherite_chestplate",
  "minecraft:netherite_leggings",
  "minecraft:netherite_boots"
];

const COOKED_FOOD_ITEMS = [
  "minecraft:cooked_beef",
  "minecraft:cooked_porkchop",
  "minecraft:cooked_chicken",
  "minecraft:cooked_mutton",
  "minecraft:cooked_rabbit",
  "minecraft:cooked_cod",
  "minecraft:cooked_salmon",
  "minecraft:baked_potato",
  "minecraft:bread",
  "minecraft:golden_apple",
  "minecraft:enchanted_golden_apple",
  "minecraft:golden_carrot"
];

// Crop block type identifiers to audit / burn
const CROP_BLOCKS = [
  "minecraft:wheat",
  "minecraft:carrots",
  "minecraft:potatoes",
  "minecraft:beetroot",
  "minecraft:melon_stem",
  "minecraft:pumpkin_stem",
  "minecraft:torchflower_crop",
  "minecraft:pitcher_crop"
];

let lastDawnProcessedDay = -1;

// Helper function to calculate taxation priority rank (0: highest priority)
export function getItemPriority(itemId) {
  if (DIAMOND_ITEMS.includes(itemId) || NETHERITE_ITEMS.includes(itemId)) {
    return 0; // Top priority: diamonds & netherite
  }
  if (COOKED_FOOD_ITEMS.includes(itemId)) {
    return 1; // Second priority: cooked food
  }
  return 2; // All other items
}

// Pure function to calculate item deductions for 30% tax rate
export function calculateTaxDeductions(inventorySlots) {
  let totalItems = 0;
  for (const item of inventorySlots) {
    if (item && item.amount > 0) {
      totalItems += item.amount;
    }
  }

  if (totalItems === 0) {
    return { taxTarget: 0, deductions: [], totalDeducted: 0 };
  }

  // 30% tax cut (round up to ensure at least 1 item is taken if inventory isn't empty)
  const taxTarget = Math.ceil(totalItems * 0.30);
  let taxRemaining = taxTarget;

  // Sort slots by priority (0 first), then by amount descending
  const sortedSlots = [...inventorySlots]
    .filter(item => item && item.amount > 0)
    .sort((a, b) => {
      const prioA = getItemPriority(a.id);
      const prioB = getItemPriority(b.id);
      if (prioA !== prioB) return prioA - prioB;
      return b.amount - a.amount;
    });

  const deductions = [];
  let totalDeducted = 0;

  for (const slotItem of sortedSlots) {
    if (taxRemaining <= 0) break;

    const takeAmount = Math.min(slotItem.amount, taxRemaining);
    deductions.push({
      slot: slotItem.slot,
      id: slotItem.id,
      amountToTake: takeAmount
    });

    taxRemaining -= takeAmount;
    totalDeducted += takeAmount;
  }

  return { taxTarget, deductions, totalDeducted };
}

// Perform Tax Collection on a player in Minecraft Bedrock
function collectTaxesFromPlayer(player) {
  const container = player.getComponent("inventory")?.container;
  if (!container) return { totalDeducted: 0, totalItems: 0 };

  const inventorySlots = [];
  let totalItems = 0;

  for (let i = 0; i < container.size; i++) {
    const item = container.getItem(i);
    if (item) {
      inventorySlots.push({ slot: i, id: item.typeId, amount: item.amount });
      totalItems += item.amount;
    }
  }

  const { taxTarget, deductions, totalDeducted } = calculateTaxDeductions(inventorySlots);

  if (totalItems === 0 || totalDeducted === 0) {
    return { totalDeducted: 0, totalItems: 0 };
  }

  // Apply deductions to actual container
  for (const ded of deductions) {
    const item = container.getItem(ded.slot);
    if (item) {
      if (item.amount <= ded.amountToTake) {
        container.setItem(ded.slot, undefined);
      } else {
        item.amount -= ded.amountToTake;
        container.setItem(ded.slot, item);
      }
    }
  }

  return { totalDeducted, totalItems };
}

// Teleport or spawn tax collector near player's bed / spawn point
function handleDawnTaxCollection() {
  const overworld = world.getDimension("overworld");
  const players = world.getAllPlayers();

  for (const player of players) {
    const spawnPoint = player.getSpawnPoint();
    let targetPos = player.location;
    let locationSource = "location";

    if (spawnPoint) {
      targetPos = { x: spawnPoint.x, y: spawnPoint.y, z: spawnPoint.z };
      locationSource = "bed";
    }

    // Teleport existing tax collector or spawn a new unkillable Tax Collector mob
    let taxCollector = overworld.getEntities({ type: "tax:tax_collector" })[0];
    if (taxCollector) {
      taxCollector.teleport(targetPos);
    } else {
      taxCollector = overworld.spawnEntity("tax:tax_collector", targetPos);
      taxCollector.nameTag = "IRS Tax Collector";
    }

    player.sendMessage(`§c[IRS Notice] §fDawn has arrived! The IRS Tax Collector teleported to your ${locationSource}!`);

    // Collect 30% taxes
    const { totalDeducted, totalItems } = collectTaxesFromPlayer(player);

    if (totalItems === 0 || totalDeducted === 0) {
      // Failed to pay (empty inventory or zero tax collected) -> Apply Audit Status Effect!
      applyAuditStatusEffect(player, overworld);
    } else {
      player.sendMessage(`§g[IRS Receipt] §fThe Tax Collector collected 30% of your inventory (${totalDeducted} items). Thank you for your compliance!`);
    }
  }
}

// Apply Audit status effect and spawn phantom auditors to burn crops
function applyAuditStatusEffect(player, dimension) {
  player.sendMessage(`§4[TAX AUDIT] §cYou failed to pay your 30% taxes! You are under AUDIT status effect!`);
  player.addEffect("slowness", 1200, { amplifier: 1, showParticles: true });
  player.addEffect("weakness", 1200, { amplifier: 1, showParticles: true });

  const pLoc = player.location;

  // Spawn 3 Phantom Auditors around the player
  for (let i = 0; i < 3; i++) {
    const offset = {
      x: pLoc.x + (Math.random() * 10 - 5),
      y: pLoc.y + 2,
      z: pLoc.z + (Math.random() * 10 - 5)
    };
    const auditor = dimension.spawnEntity("tax:phantom_auditor", offset);
    auditor.nameTag = "Phantom Auditor";
  }

  // Find nearby crops and burn them (optimized radius and Y range)
  auditAndBurnCrops(dimension, pLoc);
}

// Scan targeted area around player for farmland / crops and set them on fire / destroy them
function auditAndBurnCrops(dimension, centerPos) {
  const radius = 8;
  const minX = Math.floor(centerPos.x - radius);
  const maxX = Math.floor(centerPos.x + radius);
  const minY = Math.floor(centerPos.y - 2);
  const maxY = Math.floor(centerPos.y + 2);
  const minZ = Math.floor(centerPos.z - radius);
  const maxZ = Math.floor(centerPos.z + radius);

  let burnedCropsCount = 0;

  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        const block = dimension.getBlock({ x, y, z });
        if (!block) continue;

        const typeId = block.typeId;
        if (CROP_BLOCKS.includes(typeId) || typeId === "minecraft:farmland") {
          const aboveBlock = dimension.getBlock({ x, y: y + 1, z });
          if (aboveBlock && aboveBlock.isAir) {
            aboveBlock.setType("minecraft:fire");
            burnedCropsCount++;
          } else {
            block.setType("minecraft:fire");
            burnedCropsCount++;
          }
        }
      }
    }
  }

  if (burnedCropsCount > 0) {
    world.sendMessage(`§4[IRS Audit Action] §cPhantom Auditors burned ${burnedCropsCount} crop blocks!`);
  }
}

// Main tick listener to detect dawn (time of day between 0 and 300)
system.runInterval(() => {
  // Use world.getTimeOfDay() or world.getAbsoluteTime() % 24000 to check time of day
  const timeOfDay = typeof world.getTimeOfDay === "function" ? world.getTimeOfDay() : (world.getAbsoluteTime() % 24000);
  const currentDay = Math.floor(world.getAbsoluteTime() / 24000);

  // Dawn happens when timeOfDay is around 0 - 300 (sunrise starts at 0)
  if (timeOfDay >= 0 && timeOfDay <= 300 && currentDay !== lastDawnProcessedDay) {
    lastDawnProcessedDay = currentDay;
    handleDawnTaxCollection();
  }
}, 20); // Check every second (20 ticks)
