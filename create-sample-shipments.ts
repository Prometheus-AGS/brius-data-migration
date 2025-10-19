import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!);

// Realistic shipping carriers and their tracking number patterns
const carriers = [
  { name: 'UPS', weight: 40 },
  { name: 'FedEx', weight: 35 },
  { name: 'USPS', weight: 20 },
  { name: 'DHL', weight: 5 }
];

// Sample shipping addresses for orthodontic equipment
const sampleAddresses = [
  {
    street: '123 Dental Plaza Suite 200',
    city: 'Dallas',
    state: 'TX',
    zip: '75201',
    country: 'USA'
  },
  {
    street: '456 Medical Drive',
    city: 'Los Angeles',
    state: 'CA',
    zip: '90210',
    country: 'USA'
  },
  {
    street: '789 Healthcare Blvd',
    city: 'Miami',
    state: 'FL',
    zip: '33101',
    country: 'USA'
  },
  {
    street: '321 Orthodontic Way',
    city: 'Chicago',
    state: 'IL',
    zip: '60601',
    country: 'USA'
  },
  {
    street: '654 Smile Street',
    city: 'New York',
    state: 'NY',
    zip: '10001',
    country: 'USA'
  }
];

function generateTrackingNumber(carrier: string): string {
  switch (carrier) {
    case 'UPS':
      return `1Z${Math.random().toString(36).substr(2, 6).toUpperCase()}${Math.floor(Math.random() * 100000000).toString().padStart(8, '0')}`;
    case 'FedEx':
      return `${Math.floor(Math.random() * 9000000000) + 1000000000}`;
    case 'USPS':
      return `9400${Math.floor(Math.random() * 100000000000000).toString().padStart(14, '0')}`;
    case 'DHL':
      return `${Math.floor(Math.random() * 9000000000) + 1000000000}`;
    default:
      return `TRK${Math.floor(Math.random() * 1000000000)}`;
  }
}

function selectCarrier(): string {
  const totalWeight = carriers.reduce((sum, c) => sum + c.weight, 0);
  const random = Math.random() * totalWeight;
  let currentWeight = 0;

  for (const carrier of carriers) {
    currentWeight += carrier.weight;
    if (random <= currentWeight) {
      return carrier.name;
    }
  }
  return carriers[0].name;
}

function getRandomAddress() {
  return sampleAddresses[Math.floor(Math.random() * sampleAddresses.length)];
}

function calculateShippingDates(orderCreatedAt: string) {
  const orderDate = new Date(orderCreatedAt);

  // Shipping: 1-5 business days after order
  const shippingDays = Math.floor(Math.random() * 5) + 1;
  const shippedAt = new Date(orderDate);
  shippedAt.setDate(shippedAt.getDate() + shippingDays);

  // Delivery: 2-7 days after shipping
  const deliveryDays = Math.floor(Math.random() * 6) + 2;
  const deliveredAt = new Date(shippedAt);
  deliveredAt.setDate(deliveredAt.getDate() + deliveryDays);

  return {
    shippedAt: shippedAt.toISOString(),
    deliveredAt: deliveredAt.toISOString()
  };
}

async function createSampleShipments() {
  console.log('🚢 Creating sample shipments for existing orders...\n');

  try {
    // Get current shipments count
    const { count: existingShipments } = await supabase
      .from('shipments')
      .select('*', { count: 'exact', head: true });

    console.log(`📦 Current shipments: ${existingShipments || 0}`);

    // Get total orders count
    const { count: totalOrders } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true });

    console.log(`📋 Total orders available: ${totalOrders || 0}`);

    if (!totalOrders || totalOrders === 0) {
      console.log('❌ No orders found to create shipments for');
      return;
    }

    // Create shipments for a sample of orders (start with 1000 for testing)
    const sampleSize = Math.min(1000, totalOrders);
    console.log(`🎯 Creating shipments for ${sampleSize} orders...\n`);

    // Get sample orders
    const { data: orders, error: ordersError } = await supabase
      .from('orders')
      .select('id, created_at, patient_id, metadata')
      .limit(sampleSize)
      .order('created_at', { ascending: false }); // Recent orders first

    if (ordersError) {
      console.error('❌ Error fetching orders:', ordersError);
      return;
    }

    if (!orders || orders.length === 0) {
      console.log('❌ No orders retrieved');
      return;
    }

    console.log(`✅ Retrieved ${orders.length} orders for shipment creation\n`);

    // Create shipments in batches
    const batchSize = 50;
    let totalCreated = 0;

    for (let i = 0; i < orders.length; i += batchSize) {
      const batch = orders.slice(i, i + batchSize);

      const shipments = batch.map(order => {
        const carrier = selectCarrier();
        const { shippedAt, deliveredAt } = calculateShippingDates(order.created_at);
        const address = getRandomAddress();

        return {
          order_id: order.id,
          tracking_number: generateTrackingNumber(carrier),
          carrier: carrier,
          shipped_at: shippedAt,
          delivered_at: Math.random() > 0.1 ? deliveredAt : null, // 90% delivered, 10% in transit
          shipping_address: address,
          metadata: {
            created_by: 'sample_migration',
            migration_batch: Math.floor(i / batchSize) + 1,
            order_patient_id: order.patient_id
          }
        };
      });

      const { data: insertedShipments, error: insertError } = await supabase
        .from('shipments')
        .insert(shipments)
        .select('id, tracking_number, carrier');

      if (insertError) {
        console.error(`❌ Error inserting batch ${Math.floor(i / batchSize) + 1}:`, insertError);
        continue;
      }

      totalCreated += insertedShipments?.length || 0;
      console.log(`✅ Batch ${Math.floor(i / batchSize) + 1}: Created ${insertedShipments?.length || 0} shipments (Total: ${totalCreated})`);
    }

    // Final summary
    console.log('\n📊 SHIPMENT CREATION SUMMARY:');
    console.log(`✅ Orders processed: ${orders.length}`);
    console.log(`✅ Shipments created: ${totalCreated}`);
    console.log(`📦 Success rate: ${((totalCreated / orders.length) * 100).toFixed(1)}%`);

    // Verify final count
    const { count: finalShipments } = await supabase
      .from('shipments')
      .select('*', { count: 'exact', head: true });

    console.log(`📦 Final shipments count: ${finalShipments || 0}`);

    // Show carrier distribution
    const { data: carrierStats } = await supabase
      .from('shipments')
      .select('carrier')
      .not('carrier', 'is', null);

    if (carrierStats) {
      const carrierCount = carrierStats.reduce((acc: any, ship: any) => {
        acc[ship.carrier] = (acc[ship.carrier] || 0) + 1;
        return acc;
      }, {});

      console.log('\n📈 Carrier Distribution:');
      Object.entries(carrierCount).forEach(([carrier, count]) => {
        console.log(`   ${carrier}: ${count} shipments`);
      });
    }

    // Show sample shipments
    const { data: sampleShipments } = await supabase
      .from('shipments')
      .select('id, tracking_number, carrier, shipped_at, delivered_at')
      .limit(5)
      .order('created_at', { ascending: false });

    if (sampleShipments && sampleShipments.length > 0) {
      console.log('\n📋 Sample Created Shipments:');
      sampleShipments.forEach((ship, index) => {
        const status = ship.delivered_at ? '📦 Delivered' : '🚚 In Transit';
        console.log(`   ${index + 1}. ${ship.carrier} ${ship.tracking_number} - ${status}`);
      });
    }

  } catch (error: any) {
    console.error('❌ Shipment creation failed:', error);
    throw error;
  }

  console.log('\n🎉 Sample shipment creation completed!');
}

// Run the shipment creation
if (require.main === module) {
  createSampleShipments().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export default createSampleShipments;