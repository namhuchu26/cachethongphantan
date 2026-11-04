const amqp = require('amqplib');
const config = require('../config');

const QUEUE = 'payments';
const DLX = 'payments.dlx';
const DLQ = 'payments.dlq';

let channel;

// Khai báo hàng đợi bền vững (durable) + dead-letter queue.
// Payment Worker khai báo y hệt; hai bên phải giống nhau từng tham số.
async function assertTopology(ch) {
  await ch.assertExchange(DLX, 'direct', { durable: true });
  await ch.assertQueue(DLQ, { durable: true });
  await ch.bindQueue(DLQ, DLX, DLQ);
  await ch.assertQueue(QUEUE, {
    durable: true,
    deadLetterExchange: DLX,
    deadLetterRoutingKey: DLQ,
  });
}

async function connectWithRetry() {
  for (let i = 1; ; i++) {
    try {
      return await amqp.connect(config.amqpUrl);
    } catch (err) {
      if (i >= 30) throw err;
      console.log(`[mq] chưa kết nối được RabbitMQ (lần ${i}): ${err.message}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function connectMq() {
  const conn = await connectWithRetry();
  // Mất kết nối RabbitMQ → thoát để Docker khởi động lại (restart: unless-stopped)
  conn.on('close', () => {
    console.error('[mq] connection closed, exiting');
    process.exit(1);
  });
  conn.on('error', (err) => console.error('[mq]', err.message));
  channel = await conn.createConfirmChannel();
  await assertTopology(channel);
}

/** Gửi job thanh toán; persistent = RabbitMQ ghi xuống đĩa, khởi động lại không mất */
function publishPayment(job) {
  return new Promise((resolve, reject) => {
    channel.sendToQueue(QUEUE, Buffer.from(JSON.stringify(job)), {
      persistent: true,
      contentType: 'application/json',
      messageId: job.bookingId,
    }, (err) => (err ? reject(err) : resolve()));
  });
}

async function queueInfo() {
  const q = await channel.checkQueue(QUEUE);
  const d = await channel.checkQueue(DLQ);
  return { pending: q.messageCount, consumers: q.consumerCount, deadLetters: d.messageCount };
}

module.exports = { connectMq, publishPayment, queueInfo };
