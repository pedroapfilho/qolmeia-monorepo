import "dotenv/config";

import { prisma } from "../src/client";
import { seedProductDefaults } from "../src/product-seed";

await seedProductDefaults(prisma);
await prisma.$disconnect();
