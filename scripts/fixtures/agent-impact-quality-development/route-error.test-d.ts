import { expectAssignable } from 'tsd'
import { errorCodes } from '../../fastify'
import { FastifyErrorConstructor } from '@fastify/error'

expectAssignable<FastifyErrorConstructor>(errorCodes.FST_ERR_ROUTE_LOG_LEVEL_INVALID)
