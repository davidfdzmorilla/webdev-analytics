# Real-time Analytics Platform — Design Document

**Project**: webdev-analytics  
**Level**: 4.2 (Event Streaming & Real-time Analytics)  
**Version**: 0.1.0  
**Date**: 2025-02-13

---

## Executive Summary

Build a **real-time analytics platform** using **event streaming** to process and analyze business events at scale. Demonstrate production-grade **event sourcing**, **CQRS**, **stream processing**, and **Lambda architecture** patterns.

**Core Capabilities**:
```
Event Producers → Event Broker → Stream Processors → Analytics
                      ↓
                  Event Store (immutable log)
                      ↓
                  Batch Processing (historical analytics)
```

---

## Problem Statement

**Traditional Analytics Limitations**:
- ❌ Batch processing only (ETL runs hourly/daily)
- ❌ Stale data (decisions based on yesterday's data)
- ❌ No real-time anomaly detection
- ❌ Slow time-to-insight

**Real-time Analytics Benefits**:
- ✅ Live dashboards (sales, user activity)
- ✅ Instant anomaly detection (fraud, spikes)
- ✅ Immediate insights (A/B test results)
- ✅ Real-time personalization (recommendations)
- ✅ Event sourcing (complete audit trail)

---

## Use Cases

### 1. Real-time Sales Dashboard
**Problem**: CEO wants live sales metrics during campaign.
**Solution**: Stream order events, aggregate by minute, display in real-time.

**Metrics**:
- Orders per minute
- Revenue per minute
- Average order value (rolling window)
- Top products (last hour)
- Geographic heatmap (orders by region)

### 2. User Behavior Analytics
**Problem**: Product team needs to understand user flows.
**Solution**: Track all user interactions as events, analyze patterns.

**Events**:
- PageViewed, ProductViewed, AddedToCart, CheckoutStarted, OrderCompleted
- Session duration, bounce rate, conversion funnels

### 3. Fraud Detection
**Problem**: Detect suspicious payment patterns immediately.
**Solution**: Stream payment events, apply ML models in real-time.

**Anomalies**:
- Multiple failed payments from same IP
- High-value orders from new accounts
- Sudden spike in orders from same user

### 4. Recommendation Engine
**Problem**: Show personalized product recommendations.
**Solution**: Analyze viewing history + purchase history in real-time.

**Algorithm**:
- Collaborative filtering (users who bought X also bought Y)
- Content-based filtering (similar products)
- Real-time updates as user browses

---

## Architecture

### High-Level Design

```
┌─────────────────────────────────────────────────────────┐
│              EVENT PRODUCERS                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐             │
│  │  Orders  │  │ Payments │  │ Catalog  │             │
│  │ Service  │  │ Service  │  │ Service  │             │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘             │
└───────┼─────────────┼─────────────┼───────────────────┘
        │             │             │
        └─────────────┼─────────────┘
                      │
          ┌───────────▼───────────┐
          │    EVENT BROKER       │
          │  (NATS JetStream or   │
          │   Apache Kafka)       │
          └───────┬───────────────┘
                  │
      ┌───────────┼───────────────┐
      │           │               │
┌─────▼─────┐ ┌──▼──────────┐ ┌──▼────────────┐
│  Stream   │ │ Event Store │ │ Data Lake     │
│Processors │ │ (Append-only│ │ (S3+Parquet)  │
│ (Flink /  │ │  Log)       │ │ (Historical)  │
│Kafka      │ └──────┬──────┘ └───────┬───────┘
│ Streams)  │        │                │
└─────┬─────┘        │                │
      │              │                │
      │         ┌────▼────────────────▼─────┐
      │         │  Batch Processor          │
      │         │  (Spark / Flink Batch)    │
      │         └────────────┬──────────────┘
      │                      │
┌─────▼──────────────────────▼─────┐
│    MATERIALIZED VIEWS             │
│  (PostgreSQL / ClickHouse)        │
│  - Aggregates (hourly, daily)     │
│  - Denormalized tables for reads  │
└────────────┬──────────────────────┘
             │
    ┌────────▼─────────┐
    │  Analytics API   │  (GraphQL / REST)
    │  - Query metrics │
    │  - Real-time + historical │
    └────────┬─────────┘
             │
    ┌────────▼─────────┐
    │  Dashboard UI    │  (React + WebSocket)
    │  - Real-time charts │
    │  - Alerts         │
    └──────────────────┘
```

---

## Components

### 1. Event Broker (NATS JetStream)

**Why NATS JetStream**:
- ✅ Built-in persistence (unlike core NATS)
- ✅ Simpler than Kafka (for moderate scale)
- ✅ Exactly-once delivery semantics
- ✅ Stream replay (reprocess events)
- ✅ Consumer groups (load balancing)

**Alternative**: Apache Kafka (for very high scale, 1M+ events/sec)

**Event Schema**:
```typescript
interface DomainEvent {
  eventId: string;         // Unique event ID
  eventType: string;       // 'OrderCreated', 'PaymentProcessed'
  aggregateId: string;     // Entity ID (order ID, product ID)
  aggregateType: string;   // 'Order', 'Payment'
  timestamp: number;       // Event time (not processing time)
  version: number;         // Event schema version
  payload: Record<string, any>;  // Event data
  metadata: {
    userId?: string;
    traceId?: string;      // For distributed tracing
    causationId?: string;  // Event that caused this event
  };
}

// Example: Order Created Event
const event: DomainEvent = {
  eventId: 'evt-123',
  eventType: 'OrderCreated',
  aggregateId: 'order-456',
  aggregateType: 'Order',
  timestamp: Date.now(),
  version: 1,
  payload: {
    userId: 'user-789',
    items: [
      { productId: 'prod-1', quantity: 2, price: 49.99 }
    ],
    totalAmount: 99.98,
    status: 'PENDING'
  },
  metadata: {
    userId: 'user-789',
    traceId: 'trace-abc-123'
  }
};
```

**NATS JetStream Setup**:
```typescript
import { connect, StringCodec } from 'nats';

const nc = await connect({ servers: 'nats://localhost:4222' });
const js = nc.jetstream();

// Create stream (durable, replicated)
await js.addStream({
  name: 'ORDERS',
  subjects: ['orders.*'],  // orders.created, orders.updated
  retention: 'limits',
  max_age: 7 * 24 * 60 * 60 * 1_000_000_000, // 7 days (nanoseconds)
  storage: 'file',
  num_replicas: 3  // High availability
});

// Publish event
const sc = StringCodec();
await js.publish('orders.created', sc.encode(JSON.stringify(event)));
```

---

### 2. Stream Processors

**Goal**: Real-time aggregations and transformations.

**Examples**:
- Count orders per minute
- Calculate rolling average order value
- Detect anomalies (>3 std deviations)
- Join streams (orders + payments)

**Option A: Kafka Streams** (if using Kafka)
```java
StreamsBuilder builder = new StreamsBuilder();

KStream<String, Order> orders = builder.stream("orders");

// Aggregate: Orders per minute
orders
  .groupByKey()
  .windowedBy(TimeWindows.of(Duration.ofMinutes(1)))
  .count()
  .toStream()
  .to("orders-per-minute");
```

**Option B: Apache Flink** (More powerful, complex joins)
```java
DataStream<Order> orders = env
  .addSource(new FlinkKafkaConsumer<>("orders", schema, props));

// Windowed aggregation
DataStream<OrderStats> stats = orders
  .keyBy(order -> order.getRegion())
  .window(TumblingEventTimeWindows.of(Time.minutes(1)))
  .aggregate(new OrderAggregator());

stats.addSink(new JdbcSink<>(...));
```

**Option C: Node.js Custom Processor** (Simple, for moderate scale)
```typescript
class OrderStatsProcessor {
  private windows: Map<string, WindowStats> = new Map();
  
  async processEvent(event: DomainEvent) {
    const windowKey = this.getWindowKey(event.timestamp, 60000); // 1 min
    
    if (!this.windows.has(windowKey)) {
      this.windows.set(windowKey, { count: 0, totalAmount: 0 });
    }
    
    const stats = this.windows.get(windowKey)!;
    stats.count++;
    stats.totalAmount += event.payload.totalAmount;
    
    // Emit aggregate
    await this.emit({
      window: windowKey,
      ordersCount: stats.count,
      totalRevenue: stats.totalAmount,
      avgOrderValue: stats.totalAmount / stats.count
    });
  }
  
  private getWindowKey(timestamp: number, windowSize: number): string {
    const windowStart = Math.floor(timestamp / windowSize) * windowSize;
    return new Date(windowStart).toISOString();
  }
}
```

---

### 3. Event Store (Immutable Log)

**Purpose**: Store ALL events forever (complete audit trail).

**Storage Options**:

#### Option A: EventStoreDB (Purpose-built event store)
```typescript
import { EventStoreDBClient } from '@eventstore/db-client';

const client = new EventStoreDBClient({ endpoint: 'localhost:2113' });

// Append event
await client.appendToStream('order-123', [
  {
    type: 'OrderCreated',
    data: { userId: 'user-456', totalAmount: 99.99 },
    metadata: { traceId: 'trace-abc' }
  }
]);

// Read stream (all events for order-123)
const events = client.readStream('order-123');
for await (const event of events) {
  console.log(event);
}
```

#### Option B: PostgreSQL (Simpler, good for moderate scale)
```sql
CREATE TABLE events (
  event_id UUID PRIMARY KEY,
  event_type VARCHAR(100) NOT NULL,
  aggregate_id VARCHAR(100) NOT NULL,
  aggregate_type VARCHAR(50) NOT NULL,
  version INT NOT NULL,
  timestamp BIGINT NOT NULL,
  payload JSONB NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_aggregate ON events(aggregate_id, version);
CREATE INDEX idx_event_type ON events(event_type);
CREATE INDEX idx_timestamp ON events(timestamp);
```

**Event Replay** (Rebuild projections from events):
```typescript
class ProjectionRebuilder {
  async rebuildOrderStats() {
    // Delete existing stats
    await db.query('DELETE FROM order_stats');
    
    // Replay all order events
    const events = await eventStore.readAllEvents('OrderCreated');
    
    for (const event of events) {
      await orderStatsProcessor.processEvent(event);
    }
  }
}
```

---

### 4. CQRS (Command Query Responsibility Segregation)

**Problem**: Writes and reads have different requirements.

**Writes**:
- Validate business rules
- Emit events
- Need strong consistency

**Reads**:
- No business logic
- Fast queries (pre-aggregated)
- Eventual consistency OK

**Solution**: Separate write and read models.

**Architecture**:
```
WRITE SIDE (Commands)
┌────────────────────┐
│ Command Handler    │
│ - Validate         │
│ - Emit events      │
└────────┬───────────┘
         │
         ▼
┌────────────────────┐
│   Event Store      │ (Source of truth)
└────────┬───────────┘
         │
         ▼
┌────────────────────┐
│ Event Projections  │ (Async, eventual consistency)
│ - Build read model │
└────────┬───────────┘
         │
         ▼
READ SIDE (Queries)
┌────────────────────┐
│  Read Model (SQL)  │ (Denormalized, optimized for queries)
│ - order_stats      │
│ - user_analytics   │
└────────────────────┘
```

**Implementation**:
```typescript
// WRITE SIDE: Command Handler
class CreateOrderCommandHandler {
  async handle(command: CreateOrderCommand) {
    // 1. Validate
    if (command.items.length === 0) {
      throw new Error('Order must have items');
    }
    
    // 2. Create aggregate
    const order = Order.create(command);
    
    // 3. Emit events
    const events = order.getUncommittedEvents();
    for (const event of events) {
      await eventStore.append(event);
      await eventBus.publish(event);
    }
  }
}

// READ SIDE: Query Handler
class GetOrderStatsQueryHandler {
  async handle(query: GetOrderStatsQuery): Promise<OrderStats> {
    // Query pre-computed read model (fast!)
    return await db.query(`
      SELECT 
        window_start,
        orders_count,
        total_revenue,
        avg_order_value
      FROM order_stats
      WHERE window_start >= $1 AND window_start <= $2
    `, [query.from, query.to]);
  }
}
```

**Benefits**:
- ✅ Write model optimized for business rules
- ✅ Read model optimized for queries
- ✅ Scale reads and writes independently
- ✅ Multiple read models for different views

---

### 5. Materialized Views (Pre-computed Aggregates)

**Problem**: Real-time aggregation too slow for complex queries.

**Solution**: Pre-compute aggregates, update as events arrive.

**Example Views**:

#### View 1: Order Stats (Hourly)
```sql
CREATE TABLE order_stats_hourly (
  window_start TIMESTAMP PRIMARY KEY,
  orders_count INT NOT NULL,
  total_revenue DECIMAL(10, 2) NOT NULL,
  avg_order_value DECIMAL(10, 2) NOT NULL,
  top_product_id VARCHAR(50),
  top_category VARCHAR(50),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**Update Logic** (Event Projection):
```typescript
class HourlyStatsProjection {
  @EventHandler('OrderCreated')
  async onOrderCreated(event: DomainEvent) {
    const windowStart = this.getHourWindowStart(event.timestamp);
    
    await db.query(`
      INSERT INTO order_stats_hourly (window_start, orders_count, total_revenue, avg_order_value)
      VALUES ($1, 1, $2, $2)
      ON CONFLICT (window_start) DO UPDATE SET
        orders_count = order_stats_hourly.orders_count + 1,
        total_revenue = order_stats_hourly.total_revenue + $2,
        avg_order_value = (order_stats_hourly.total_revenue + $2) / (order_stats_hourly.orders_count + 1),
        updated_at = NOW()
    `, [windowStart, event.payload.totalAmount]);
  }
}
```

#### View 2: User Funnel Conversion
```sql
CREATE TABLE user_funnel (
  date DATE,
  stage VARCHAR(50),  -- 'visited', 'viewed_product', 'added_to_cart', 'purchased'
  user_count INT,
  PRIMARY KEY (date, stage)
);
```

**Query for Conversion Rate**:
```sql
SELECT 
  date,
  MAX(CASE WHEN stage = 'visited' THEN user_count END) as visited,
  MAX(CASE WHEN stage = 'purchased' THEN user_count END) as purchased,
  (MAX(CASE WHEN stage = 'purchased' THEN user_count END)::FLOAT / 
   MAX(CASE WHEN stage = 'visited' THEN user_count END)) * 100 as conversion_rate
FROM user_funnel
WHERE date >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY date
ORDER BY date;
```

---

### 6. Lambda Architecture (Batch + Stream)

**Problem**: Stream processing complex for some queries. Need historical data reprocessing.

**Solution**: Combine batch and stream processing.

**Architecture**:
```
┌────────────────────────────────────────────┐
│          BATCH LAYER (Historical)          │
│  ┌──────────────────────────────────┐     │
│  │  Data Lake (S3 + Parquet)        │     │
│  │  - All events (compressed)       │     │
│  │  - Partitioned by date           │     │
│  └──────────┬───────────────────────┘     │
│             │                              │
│  ┌──────────▼───────────────────────┐     │
│  │  Batch Processor (Spark)         │     │
│  │  - Daily aggregations            │     │
│  │  - ML model training             │     │
│  └──────────┬───────────────────────┘     │
│             │                              │
│             ▼                              │
│  ┌─────────────────────────────────┐      │
│  │  Batch Views (PostgreSQL)       │      │
│  │  - Historical aggregates         │      │
│  └─────────────────────────────────┘      │
└────────────────────────────────────────────┘

┌────────────────────────────────────────────┐
│         SPEED LAYER (Real-time)            │
│  ┌──────────────────────────────────┐     │
│  │  Stream Processor (Flink)        │     │
│  │  - Real-time aggregations        │     │
│  └──────────┬───────────────────────┘     │
│             │                              │
│             ▼                              │
│  ┌─────────────────────────────────┐      │
│  │  Real-time Views (PostgreSQL)   │      │
│  │  - Last 24 hours                 │      │
│  └─────────────────────────────────┘      │
└────────────────────────────────────────────┘

┌────────────────────────────────────────────┐
│          SERVING LAYER (Queries)           │
│  Merge batch views + real-time views       │
│  - Historical: Query batch layer          │
│  - Recent: Query speed layer              │
└────────────────────────────────────────────┘
```

**Query Example** (Last 30 days stats):
```typescript
class AnalyticsService {
  async getOrderStats(fromDate: Date, toDate: Date): Promise<OrderStats[]> {
    const cutoffDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24h ago
    
    // Historical data (batch layer)
    const historicalStats = await db.query(`
      SELECT * FROM order_stats_daily
      WHERE date >= $1 AND date < $2
    `, [fromDate, cutoffDate]);
    
    // Recent data (speed layer)
    const recentStats = await db.query(`
      SELECT * FROM order_stats_realtime
      WHERE window_start >= $1
    `, [cutoffDate]);
    
    // Merge results
    return [...historicalStats, ...recentStats];
  }
}
```

**Benefits**:
- ✅ Batch layer: Accurate, reprocessable
- ✅ Speed layer: Low latency, real-time
- ✅ Best of both worlds

**Drawbacks**:
- ❌ Complexity (maintain two systems)
- ❌ Code duplication (batch + stream logic)

**Alternative**: **Kappa Architecture** (stream-only, simpler)

---

### 7. Data Lake (S3 + Parquet)

**Purpose**: Long-term storage of all events for batch processing.

**Storage Format**: Apache Parquet (columnar, compressed)

**Partitioning Strategy**:
```
s3://analytics-data-lake/
  events/
    year=2025/
      month=02/
        day=13/
          hour=08/
            events-08-00.parquet  (10MB)
            events-08-01.parquet  (10MB)
```

**Writing Events to S3**:
```typescript
class EventArchiver {
  private buffer: DomainEvent[] = [];
  private readonly BATCH_SIZE = 10000;
  
  async archiveEvent(event: DomainEvent) {
    this.buffer.push(event);
    
    if (this.buffer.length >= this.BATCH_SIZE) {
      await this.flush();
    }
  }
  
  private async flush() {
    const date = new Date();
    const partition = `year=${date.getFullYear()}/month=${date.getMonth()+1}/day=${date.getDate()}/hour=${date.getHours()}`;
    const filename = `events-${date.getHours()}-${date.getMinutes()}.parquet`;
    
    // Convert to Parquet
    const parquet = await this.toParquet(this.buffer);
    
    // Upload to S3
    await s3.upload({
      Bucket: 'analytics-data-lake',
      Key: `events/${partition}/${filename}`,
      Body: parquet
    });
    
    this.buffer = [];
  }
}
```

**Querying with Spark**:
```scala
val events = spark.read.parquet("s3://analytics-data-lake/events/year=2025/month=02/")

events
  .filter($"event_type" === "OrderCreated")
  .groupBy(window($"timestamp", "1 hour"))
  .agg(
    count("*").as("orders_count"),
    sum($"payload.totalAmount").as("total_revenue")
  )
  .write
  .mode("overwrite")
  .saveAsTable("order_stats_daily")
```

---

### 8. Analytics API (GraphQL)

**Why GraphQL**:
- Clients request exactly what they need
- Single endpoint (vs many REST endpoints)
- Real-time subscriptions (WebSocket)

**Schema**:
```graphql
type Query {
  orderStats(from: DateTime!, to: DateTime!, granularity: Granularity!): [OrderStats!]!
  userFunnel(date: Date!): FunnelStats!
  topProducts(limit: Int!): [Product!]!
}

type Subscription {
  orderStatsLive(granularity: Granularity!): OrderStats!
}

enum Granularity {
  MINUTE
  HOUR
  DAY
}

type OrderStats {
  windowStart: DateTime!
  ordersCount: Int!
  totalRevenue: Float!
  avgOrderValue: Float!
}

type FunnelStats {
  stage: String!
  userCount: Int!
  conversionRate: Float!
}
```

**Resolvers**:
```typescript
const resolvers = {
  Query: {
    orderStats: async (_, { from, to, granularity }) => {
      return await analyticsService.getOrderStats(from, to, granularity);
    },
    topProducts: async (_, { limit }) => {
      return await analyticsService.getTopProducts(limit);
    }
  },
  
  Subscription: {
    orderStatsLive: {
      subscribe: (_, { granularity }) => {
        return pubsub.asyncIterator(`ORDER_STATS_${granularity}`);
      }
    }
  }
};
```

**Real-time Subscription** (Client):
```typescript
const subscription = client.subscribe({
  query: gql`
    subscription {
      orderStatsLive(granularity: MINUTE) {
        windowStart
        ordersCount
        totalRevenue
        avgOrderValue
      }
    }
  `
});

subscription.subscribe(({ data }) => {
  console.log('New stats:', data.orderStatsLive);
  updateChart(data.orderStatsLive);
});
```

---

### 9. Real-time Dashboard (React + WebSocket)

**UI Components**:
1. **Live Orders Chart** (orders/min, last hour)
2. **Revenue Gauge** (today's revenue vs. target)
3. **Top Products Table** (best sellers, real-time)
4. **Geographic Heatmap** (orders by region)
5. **Conversion Funnel** (visited → purchased)
6. **Alerts** (anomalies detected)

**WebSocket Connection**:
```typescript
import { useSubscription } from '@apollo/client';

function LiveOrdersChart() {
  const { data, loading } = useSubscription(ORDER_STATS_LIVE, {
    variables: { granularity: 'MINUTE' }
  });
  
  useEffect(() => {
    if (data) {
      // Update chart with new data point
      addDataPoint(data.orderStatsLive);
    }
  }, [data]);
  
  return <LineChart data={chartData} />;
}
```

**Chart Libraries**:
- **Recharts** (React charts)
- **D3.js** (custom visualizations)
- **Chart.js** (simple, performant)

---

## Advanced Patterns

### 1. Exactly-Once Semantics

**Problem**: Events processed multiple times due to retries.

**Solution**: Idempotency + Deduplication

**Implementation**:
```typescript
class IdempotentProjection {
  private processedEvents: Set<string> = new Set();
  
  async processEvent(event: DomainEvent) {
    // Check if already processed
    if (this.processedEvents.has(event.eventId)) {
      console.log('Event already processed, skipping');
      return;
    }
    
    // Process event + mark as processed (atomic transaction)
    await db.transaction(async (trx) => {
      await this.updateStats(event, trx);
      await trx.insert({ eventId: event.eventId }).into('processed_events');
    });
    
    this.processedEvents.add(event.eventId);
  }
}
```

### 2. Late-Arriving Events

**Problem**: Event arrives out of order (network delay).

**Example**:
```
Event1 (timestamp: 10:00:00) arrives at 10:00:05
Event2 (timestamp: 10:00:02) arrives at 10:00:10  ← LATE!
```

**Solution**: Watermarks + Allowed Lateness

**Flink Implementation**:
```java
stream
  .assignTimestampsAndWatermarks(
    WatermarkStrategy
      .<Event>forBoundedOutOfOrderness(Duration.ofMinutes(5))
      .withTimestampAssigner((event, timestamp) -> event.getTimestamp())
  )
  .keyBy(Event::getUserId)
  .window(TumblingEventTimeWindows.of(Time.minutes(1)))
  .allowedLateness(Time.minutes(5))  // Wait 5 min for late events
  .aggregate(new EventAggregator());
```

### 3. Backpressure Handling

**Problem**: Consumers can't keep up with producers.

**Solution**: Flow control (pause/resume producers)

**NATS JetStream** (Built-in backpressure):
```typescript
const subscription = await js.subscribe('orders.*', {
  manual_ack: true,
  max_ack_pending: 100  // Pause after 100 unacked messages
});

for await (const msg of subscription) {
  try {
    await processEvent(msg.json());
    msg.ack();  // ACK after successful processing
  } catch (error) {
    msg.nak();  // NACK → requeue
  }
}
```

### 4. Schema Evolution

**Problem**: Event schema changes over time.

**Example**:
```typescript
// Version 1
{ eventType: 'OrderCreated', payload: { totalAmount: 99.99 } }

// Version 2 (add currency field)
{ eventType: 'OrderCreated', version: 2, payload: { totalAmount: 99.99, currency: 'USD' } }
```

**Solution**: Version field + backward compatibility

**Projection Handling**:
```typescript
class OrderProjection {
  async onOrderCreated(event: DomainEvent) {
    if (event.version === 1) {
      // Assume USD for old events
      event.payload.currency = 'USD';
    }
    
    await this.updateStats(event);
  }
}
```

---

## Observability

### Metrics (Prometheus)

**Stream Processor Metrics**:
```typescript
const eventsProcessed = new Counter({
  name: 'events_processed_total',
  help: 'Total events processed',
  labelNames: ['event_type', 'status']
});

const processingLatency = new Histogram({
  name: 'event_processing_duration_seconds',
  help: 'Event processing latency',
  labelNames: ['event_type']
});

async function processEvent(event: DomainEvent) {
  const start = Date.now();
  
  try {
    await processor.process(event);
    eventsProcessed.inc({ event_type: event.eventType, status: 'success' });
  } catch (error) {
    eventsProcessed.inc({ event_type: event.eventType, status: 'error' });
    throw error;
  } finally {
    processingLatency.observe({ event_type: event.eventType }, (Date.now() - start) / 1000);
  }
}
```

**Dashboard**:
```
┌─────────────────────────────────────────┐
│  Stream Processing Health                │
├─────────────────────────────────────────┤
│ Events/sec:         1,250               │
│ Processing Latency: 15ms (p95)          │
│ Error Rate:         0.01%               │
│ Lag:                500 events          │
├─────────────────────────────────────────┤
│ [Graph: Event Throughput]               │
│ [Graph: Processing Latency]             │
│ [Graph: Consumer Lag]                   │
└─────────────────────────────────────────┘
```

---

## Testing

### Unit Tests (Projections)
```typescript
describe('HourlyStatsProjection', () => {
  it('should aggregate orders in hourly window', async () => {
    const projection = new HourlyStatsProjection(mockDb);
    
    await projection.onOrderCreated({
      eventId: '1',
      eventType: 'OrderCreated',
      timestamp: new Date('2025-02-13T10:15:00Z').getTime(),
      payload: { totalAmount: 50.00 }
    });
    
    await projection.onOrderCreated({
      eventId: '2',
      eventType: 'OrderCreated',
      timestamp: new Date('2025-02-13T10:45:00Z').getTime(),
      payload: { totalAmount: 100.00 }
    });
    
    const stats = await db.query('SELECT * FROM order_stats_hourly WHERE window_start = $1', 
      [new Date('2025-02-13T10:00:00Z')]);
    
    expect(stats.orders_count).toBe(2);
    expect(stats.total_revenue).toBe(150.00);
    expect(stats.avg_order_value).toBe(75.00);
  });
});
```

### Integration Tests (End-to-End)
```typescript
describe('Event Streaming Flow', () => {
  it('should process event from producer to dashboard', async () => {
    // 1. Publish event
    await eventBus.publish({
      eventType: 'OrderCreated',
      payload: { totalAmount: 99.99 }
    });
    
    // 2. Wait for projection update
    await waitFor(() => {
      return db.query('SELECT * FROM order_stats_realtime LIMIT 1');
    });
    
    // 3. Query API
    const response = await graphql(schema, `
      query {
        orderStats(from: "${new Date().toISOString()}", to: "${new Date().toISOString()}", granularity: MINUTE) {
          ordersCount
          totalRevenue
        }
      }
    `);
    
    expect(response.data.orderStats[0].ordersCount).toBeGreaterThan(0);
  });
});
```

### Load Tests (Event Throughput)
```typescript
// Simulate 10,000 events/sec
for (let i = 0; i < 10000; i++) {
  await eventBus.publish({
    eventType: 'OrderCreated',
    payload: { totalAmount: Math.random() * 100 }
  });
}

// Measure:
// - Event processing latency
// - Consumer lag
// - Resource usage (CPU, memory)
```

---

## Deployment

### K3s Deployment

**NATS JetStream**:
```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: nats
spec:
  serviceName: nats
  replicas: 3
  selector:
    matchLabels:
      app: nats
  template:
    metadata:
      labels:
        app: nats
    spec:
      containers:
      - name: nats
        image: nats:2.9-alpine
        args:
        - "-js"
        - "-sd /data"
        ports:
        - containerPort: 4222
        - containerPort: 8222
        volumeMounts:
        - name: data
          mountPath: /data
  volumeClaimTemplates:
  - metadata:
      name: data
    spec:
      accessModes: ["ReadWriteOnce"]
      resources:
        requests:
          storage: 10Gi
```

**Stream Processor**:
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: analytics-processor
spec:
  replicas: 3
  selector:
    matchLabels:
      app: analytics-processor
  template:
    metadata:
      labels:
        app: analytics-processor
    spec:
      containers:
      - name: processor
        image: davidfdzmorilla/analytics-processor:1.0.0
        env:
        - name: NATS_URL
          value: "nats://nats:4222"
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: analytics-db-secret
              key: url
        resources:
          requests:
            cpu: 500m
            memory: 1Gi
          limits:
            cpu: 2000m
            memory: 4Gi
```

---

## Success Criteria

- ✅ **Event Sourcing**: All domain events stored immutably
- ✅ **CQRS**: Separate command and query models
- ✅ **Stream Processing**: Real-time aggregations (orders/min)
- ✅ **Lambda Architecture**: Batch + stream layers
- ✅ **Materialized Views**: Pre-computed aggregates
- ✅ **GraphQL API**: Real-time subscriptions working
- ✅ **Dashboard**: Live charts updating via WebSocket
- ✅ **Data Lake**: Events archived to S3 (Parquet)
- ✅ **Exactly-Once Semantics**: Idempotent projections
- ✅ **Observability**: Metrics, traces, lag monitoring

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| **Event Broker** | NATS JetStream or Apache Kafka |
| **Stream Processing** | Apache Flink or Kafka Streams or Custom (Node.js) |
| **Event Store** | PostgreSQL or EventStoreDB |
| **Data Lake** | S3 + Apache Parquet |
| **Batch Processing** | Apache Spark (optional for Lambda) |
| **Read Models** | PostgreSQL or ClickHouse |
| **API** | GraphQL (Apollo Server) |
| **Dashboard** | React + Recharts + WebSocket |
| **Observability** | Prometheus + Grafana + Jaeger |
| **Orchestration** | K3s |

---

## Roadmap

**Phase 1: Event Infrastructure** (Design Complete ✅)
- [x] Design document
- [ ] NATS JetStream setup
- [ ] Event schema definition
- [ ] Event publisher service

**Phase 2: Stream Processing**
- [ ] Implement projections (hourly stats)
- [ ] Idempotency handling
- [ ] Late-arriving events handling

**Phase 3: CQRS**
- [ ] Command handlers (write side)
- [ ] Query handlers (read side)
- [ ] Materialized views

**Phase 4: Analytics API**
- [ ] GraphQL schema
- [ ] Resolvers
- [ ] Real-time subscriptions

**Phase 5: Dashboard**
- [ ] React app
- [ ] Live charts (orders/min, revenue)
- [ ] WebSocket integration

**Phase 6: Lambda Architecture (Optional)**
- [ ] S3 data lake
- [ ] Spark batch jobs
- [ ] Merge batch + stream views

---

## References

- **Martin Kleppmann**: *Designing Data-Intensive Applications* (Chapter 11: Stream Processing)
- **Jay Kreps**: [The Log](https://engineering.linkedin.com/distributed-systems/log-what-every-software-engineer-should-know-about-real-time-datas-unifying) (Kafka creator)
- **Nathan Marz**: *Big Data* (Lambda Architecture)
- **NATS JetStream**: [docs.nats.io/jetstream](https://docs.nats.io/jetstream)
- **Apache Flink**: [flink.apache.org](https://flink.apache.org)
- **Event Sourcing**: [martinfowler.com/eaaDev/EventSourcing.html](https://martinfowler.com/eaaDev/EventSourcing.html)

---

**Status**: Design Phase Complete  
**Next**: Assess implementation approach (full build vs. architectural deliverable)
