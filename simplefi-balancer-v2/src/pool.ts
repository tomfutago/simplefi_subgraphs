import { 
  BigInt, 
  ethereum,
  Address,
  log,
} from "@graphprotocol/graph-ts"

import { Transfer } from "../generated/templates/WeightedPool/WeightedPool"

import { 
  Pool as PoolEntity, 
  PoolId as PoolIdEntity, 
  Market as MarketEntity,
  Account as AccountEntity,
} from "../generated/schema"

import {
  TokenBalance,
  getOrCreateAccount,
  redeemFromMarket,
  investInMarket,
  ADDRESS_ZERO,
} from "./common"

import {
  getOrCreateLiquidity,
  getOrCreateMint,
  createOrUpdatePositionOnMint,
  getOrCreateBurn,
  createOrUpdatePositionOnBurn,
} from "./market"

export function handleTransfer(event: Transfer): void {
  // If it's transfering zero tokens, no action required
  if (event.params.value == BigInt.fromI32(0)) {
    return
  }

  let poolAddressHex = event.address.toHexString()
  let fromHex = event.params.from.toHexString()
  let toHex = event.params.to.toHexString()

  let poolId = PoolIdEntity.load(poolAddressHex)
  let pool = PoolEntity.load(poolId.poolId)

  let accountTo: AccountEntity, accountFrom: AccountEntity

  // update account balances
  if (fromHex != ADDRESS_ZERO) {
    let accountLiquidityFrom = getOrCreateLiquidity(pool as PoolEntity, event.params.from)
    accountLiquidityFrom.balance = accountLiquidityFrom.balance.minus(event.params.value)
    accountLiquidityFrom.save()
  }

  if (fromHex != poolAddressHex) {
    let accountLiquidityTo = getOrCreateLiquidity(pool as PoolEntity, event.params.to)
    accountLiquidityTo.balance = accountLiquidityTo.balance.plus(event.params.value)
    accountLiquidityTo.save()
  }

  // @todo: research required on why we have TX like these
  if (toHex == ADDRESS_ZERO && fromHex == ADDRESS_ZERO) {
    return
  }
  
  // Protocol doesn't allow user transfers to zero address so only case is burning
  if (toHex == ADDRESS_ZERO) {
    log.info("log handleBurn {} - {} - {} - {}", [event.transaction.hash.toHexString(), toHex, fromHex, event.params.value.toString()])
    accountFrom = getOrCreateAccount(event.params.from)
    handleBurn(event, pool as PoolEntity, accountFrom)
    return
  } else if (fromHex == ADDRESS_ZERO) {
    log.info("log handleMint {} - {} - {} - {}", [event.transaction.hash.toHexString(), toHex, fromHex, event.params.value.toString()])
    accountTo = getOrCreateAccount(event.params.to)
    handleMint(event, pool as PoolEntity, accountTo)
    return
  }

  log.info("log handleTransfer {} - {} - {} - {}", [event.transaction.hash.toHexString(), toHex, fromHex, event.params.value.toString()])

  // Normal LP transfers
  transferLPToken(event, pool as PoolEntity, event.params.from, event.params.to, event.params.value)
}

function handleMint(event: Transfer, pool: PoolEntity, account: AccountEntity): void {
  let mint = getOrCreateMint(event, pool)
  mint.to = account.id
  mint.transferEventApplied = true
  mint.liquityAmount = event.params.value
  mint.save()
  createOrUpdatePositionOnMint(event, pool, mint)
}

function handleBurn(event: Transfer, pool: PoolEntity, account: AccountEntity): void {
  let burn = getOrCreateBurn(event, pool)
  burn.transferEventApplied = true
  burn.to = account.id
  burn.liquityAmount = event.params.value
  burn.save()
  createOrUpdatePositionOnBurn(event, pool, burn)
}

function transferLPToken(event: ethereum.Event, pool: PoolEntity, from: Address, to: Address, amount: BigInt): void {
  let market = MarketEntity.load(pool.address) as MarketEntity

  let fromAccount = getOrCreateAccount(from)
  let accountLiquidityFrom = getOrCreateLiquidity(pool, from)
  let fromOutputTokenBalance = accountLiquidityFrom.balance
  let fromInputTokenBalances: TokenBalance[] = []

  for (let i = 0; i < pool.tokens.length; i++) {
    let tokens = pool.tokens as string[]
    let poolReserves = pool.reserves as BigInt[]
    let fromTokenBalance = fromOutputTokenBalance.times(poolReserves[i]).div(pool.totalSupply as BigInt)
    fromInputTokenBalances.push(new TokenBalance(tokens[i], fromAccount.id, fromTokenBalance))
  }

  redeemFromMarket(
    event,
    fromAccount,
    market,
    amount,
    [],
    [],
    fromOutputTokenBalance,
    fromInputTokenBalances,
    [],
    to.toHexString()
  )

  let toAccount = getOrCreateAccount(to)
  let accountLiquidityTo = getOrCreateLiquidity(pool, to)
  let toOutputTokenBalance = accountLiquidityTo.balance
  let toInputTokenBalances: TokenBalance[] = []

  for (let i = 0; i < pool.tokens.length; i++) {
    let tokens = pool.tokens as string[]
    let poolReserves = pool.reserves as BigInt[]
    let toTokenBalance = toOutputTokenBalance.times(poolReserves[i]).div(pool.totalSupply as BigInt)
    toInputTokenBalances.push(new TokenBalance(tokens[i], toAccount.id, toTokenBalance))
  }

  investInMarket(
    event,
    toAccount,
    market,
    amount,
    [],
    [],
    toOutputTokenBalance,
    toInputTokenBalances,
    [],
    from.toHexString()
  )
}
