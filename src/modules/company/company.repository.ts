import { prisma } from '../../lib/prisma.js';

export class CompanyRepository {
  async create(data: { name: string }) {
    return await prisma.company.create({
      data,
    });
  }

  // Nested write: Creates the company and the admin user in one transaction
  async createWithAdmin(companyName: string, adminUser: any) {
    return await prisma.company.create({
      data: {
        name: companyName,
        users: {
          create: adminUser,
        },
      },
      include: {
        users: true, // Return the created users as well
      },
    });
  }

  async findByName(name: string) {
    return await prisma.company.findFirst({
      where: { name },
    });
  }

  async findAll() {
    return await prisma.company.findMany();
  }
}

export const companyRepository = new CompanyRepository();
