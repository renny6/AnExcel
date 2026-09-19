import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

async function main() {
  // Passwords for test accounts: 'password123'
  const passwordHash = await bcrypt.hash('password123', 10)

  console.log('Seeding test professors...')
  
  await prisma.professor.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      identity_source: 'test',
      external_id: 'prof1@anexcel.test',
      password_hash: passwordHash,
      name: 'Dr. John Doe',
      college_code: 'ENG01',
      department: 'Computer Science'
    }
  })

  await prisma.professor.upsert({
    where: { id: '00000000-0000-0000-0000-000000000002' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000002',
      identity_source: 'test',
      external_id: 'prof2@anexcel.test',
      password_hash: passwordHash,
      name: 'Dr. Jane Smith',
      college_code: 'ENG01',
      department: 'Electrical Engineering'
    }
  })

  await prisma.professor.upsert({
    where: { id: '00000000-0000-0000-0000-000000000003' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000003',
      identity_source: 'test',
      external_id: 'prof3@anexcel.test',
      password_hash: passwordHash,
      name: 'Dr. Alan Turing',
      college_code: 'SCI02',
      department: 'Mathematics'
    }
  })

  console.log('Seed completed successfully.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
