import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

function createSourcePool(): Pool {
  return new Pool({
    host: process.env.SOURCE_DB_HOST!,
    port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
    database: process.env.SOURCE_DB_NAME!,
    user: process.env.SOURCE_DB_USER!,
    password: process.env.SOURCE_DB_PASSWORD!,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });
}

function createTargetPool(): Pool {
  return new Pool({
    host: process.env.TARGET_DB_HOST!,
    port: parseInt(process.env.TARGET_DB_PORT || '5432'),
    database: process.env.TARGET_DB_NAME!,
    user: process.env.TARGET_DB_USER!,
    password: process.env.TARGET_DB_PASSWORD!,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });
}

async function main() {
  const sourcePool = createSourcePool();
  const targetPool = createTargetPool();
  
  try {
    console.log('🔍 Analyzing missing doctors...');
    
    // Get all doctor IDs referenced in dispatch_instruction
    console.log('📥 Fetching doctors referenced in orders...');
    const referencedDoctorsQuery = `
      SELECT DISTINCT dp.doctor_id, COUNT(*) as order_count
      FROM dispatch_instruction di
      JOIN dispatch_patient dp ON di.patient_id = dp.id
      WHERE di.deleted IS NOT TRUE
      GROUP BY dp.doctor_id
      ORDER BY order_count DESC
    `;
    
    const referencedResult = await sourcePool.query(referencedDoctorsQuery);
    const referencedDoctors = referencedResult.rows;
    console.log(`📊 Found ${referencedDoctors.length} unique doctors referenced in orders`);
    
    // Get doctors we have in target system  
    console.log('📥 Fetching doctors in target system...');
    const targetDoctorsQuery = `
      SELECT DISTINCT legacy_user_id
      FROM doctors 
      WHERE legacy_user_id IS NOT NULL
    `;
    
    const targetResult = await targetPool.query(targetDoctorsQuery);
    const targetDoctorIds = new Set(targetResult.rows.map(row => row.legacy_user_id));
    console.log(`📊 Found ${targetDoctorIds.size} doctors in target system`);
    
    // Identify missing doctors
    const missingDoctors = referencedDoctors.filter(doc => !targetDoctorIds.has(doc.doctor_id));
    const totalMissingOrders = missingDoctors.reduce((sum, doc) => sum + parseInt(doc.order_count), 0);
    
    console.log(`\n❌ Missing Doctors Analysis:`);
    console.log(`   Missing doctors: ${missingDoctors.length}`);
    console.log(`   Orders affected: ${totalMissingOrders}`);
    console.log(`   Success rate: ${Math.round((1 - totalMissingOrders / 23050) * 100)}%`);
    
    // Show top missing doctors by impact
    console.log(`\n🔝 Top Missing Doctors (by orders affected):`);
    missingDoctors.slice(0, 15).forEach((doc, index) => {
      console.log(`   ${index + 1}. Doctor ID ${doc.doctor_id}: ${doc.order_count} orders`);
    });
    
    // Check if these doctors exist in source auth_user
    console.log(`\n🔍 Checking if missing doctors exist in source auth_user table...`);
    const missingDoctorIds = missingDoctors.map(doc => doc.doctor_id);
    
    if (missingDoctorIds.length > 0) {
      const authUserQuery = `
        SELECT id, username, first_name, last_name, email, is_active
        FROM auth_user 
        WHERE id = ANY($1)
        ORDER BY id
      `;
      
      const authResult = await sourcePool.query(authUserQuery, [missingDoctorIds]);
      const foundInAuth = authResult.rows;
      
      console.log(`📊 Found ${foundInAuth.length} missing doctors in auth_user table:`);
      foundInAuth.forEach(user => {
        const orderCount = missingDoctors.find(d => d.doctor_id === user.id)?.order_count || 0;
        console.log(`   ID ${user.id}: ${user.first_name} ${user.last_name} (${user.email}) - ${orderCount} orders - Active: ${user.is_active}`);
      });
      
      console.log(`\n📋 Summary:`);
      console.log(`   Missing doctors in auth_user: ${foundInAuth.length}`);
      console.log(`   Orders that could be recovered: ${foundInAuth.reduce((sum, user) => {
        const orderCount = missingDoctors.find(d => d.doctor_id === user.id)?.order_count || 0;
        return sum + parseInt(orderCount);
      }, 0)}`);
    }
    
  } catch (error) {
    console.error('❌ Error analyzing missing doctors:', error);
    process.exit(1);
  } finally {
    await sourcePool.end();
    await targetPool.end();
  }
}

main().catch(console.error);
