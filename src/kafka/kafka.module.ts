import { Global, Module } from '@nestjs/common';
import { KafkaConsumerService } from './kafka-consumer.service';

@Global()
@Module({
  providers: [KafkaConsumerService],
  exports: [KafkaConsumerService],
})
export class KafkaModule {}
