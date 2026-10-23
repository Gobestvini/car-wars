# Authoritative room lifecycle, TASK-0098

Реализация поверх `7f3dc5e`, 2026-10-23. [Задача и решение QA](../tasks/TASK-0098-authoritative-three-player-rooms.md), [артефакты](multiplayer/2026-10-23-rooms/README.md). Публичная выкладка не выполнялась; версии browser/server обновляются вместе.

## Контракт

`tools/multiplayer-spike/hosted-room.js` создаёт единственный GameWorld и scalar Schema через `schema()/t.*`. `deploy/server.js` остаётся точкой запуска. Research DrivingSpikeRoom/SpikeWorld сохранены для старых probes; production использует свои обработчики, без двойной регистрации наследуемых callbacks.

Handshake: protocol1, presentation6, build `carwars-ws-6`, map3, generator `city-1`, случайный server roundId, фактическая signature. Все значения разделяются с клиентом через `src/multiplayer/protocol.js`. Публичные npcCount/tuning/seed игнорируются: сервер создаёт 102 civilian. Три места включают loading и reconnect reservations, их атомарность обеспечивает framework; дополнительная проверка GameWorld сохраняется.

Loading не создаёт player body. Сервер отправляет nonce и map/full DTO; клиент проверяет карту, завершает свой presentation callback и подтверждает nonce/round/signature/build/map version. Только после `map-ready` создаётся машина или включается сохранённая машина reconnect; pure appearance остаётся дополнительным физическим gate. Deadline загрузки 20 секунд освобождает место. Полный DTO включает damage/wheels/props/signals, персональные wanted/arrest/repair, shared pickups и ограниченную историю событий. Новые события имеют room/round prefix, клиент dedup хранит до128 id; late join не воспроизводит историю эффектов.

## Пределы

| Ресурс | Предел / поведение |
| --- | --- |
| Input | 1 КиБ UTF-8 JSON, 60 пакетов/с; превышение отбрасывается, >80 в окне отключает сессию |
| Все входящие room frames | 120/с на socket; >40 неизвестных сообщений также отключают; transport frame ≤4 КиБ, отдельно от input |
| Control | Сессия задаёт actor; round/generation проверяются. Один pending ordinary input, монотонный seq и ack применения. Timed commands: ≤24/packet, ≤120 будущих тиков/игрока, immutable duplicate tick; 250 мс без новых принятых commands очищают future queue и тормозят |
| Epoch | Ordinary seq ограничен signed int32; перед исчерпанием server запрашивает новую generation/epoch, без reset pose/damage/gameplay. Старые generation/round отвергаются |
| Respawn | round/generation/requestId, не чаще3с, включая reconnect; повтор request не создаёт второй respawn. До окончания appearance команда не исполняется |
| Output | `bufferedAmount + следующий frame + framing` ≤256 КиБ. Медленный socket завершается; активная машина получает обычную15с reservation и полную resync при reconnect |
| Full/welcome | Одна transfer/socket, максимум2 МиБ JSON, куски32 КиБ, по2 за patch, deadline10с. Клиент применяет только собранный DTO. `hello`/`full` ограничены1/с и не накапливают новые transfers |
| Метрики | Ограниченные histories, wire/payload/queue/debt, client/loading/reserved/body counts; maps очищаются при уходе, counts обнуляются при dispose |

Серверные decode errors/oversize закрывают только неисправный socket; protocol abuse не получает reconnect reservation. Ошибка solver закрывает только свою комнату. Reconnect15с сохраняет playerId и actor; новый socket проходит map-ready, сохраняя neutral до подтверждения. Token не переносится в другую комнату. Leave/expiry освобождают тело/полицейскую цель; последняя сессия/reservation запускает dispose. Shutdown предупреждает о потере ephemeral room, отменяет reservations и освобождает таймеры; persistence после перезапуска не обещается.

## Проверенные приёмы

**Полный snapshot больше лимита socket.** Признак: первоначальный welcome занимает около278 КиБ MessagePack ещё до трёх игроков, поэтому честный cap256 КиБ закрывает исправное подключение. Причина: карта/manifest и gameplay JSON передавались одним сообщением. Решение: ограниченная transfer поверх того же reliable socket, без увеличения cap и без частичного применения state. Проверка23 октября: реальные SDK, high/low WebGL client, поздний вход и reconnect прошли. Ограничение: это не bandwidth-cap/WAN приёмка0100.

**`onMessage` добавляет callback.** Повторная регистрация в subclass не заменяет базовый handler в Colyseus0.18.18: старый `hello` всё ещё отправлял большой welcome. Решение: явный `registerMessages:false` для hosted adapter, research сохраняет прежние callbacks. Проверено по коду установленной библиотеки и повторными SDK/browser тестами; не переносить предположение о замене handler на другие версии.

**Номинальный interval не доказывает cadence.** С обычными intervals измерено около39.95 scheduler/16.46 patch Hz при сохранённых120 physics. Для hosted callbacks используются независимые абсолютные deadlines60/20Hz; только физика имеет accumulator, максимум10 steps/callback. Финальный local прогон:59.899/20.008Hz, physics120.071Hz, droppedSeconds0, maxDebt47.56мс. Histogram p95 interval30.59/62.31мс показывает jitter Windows. Есть unit с квантованием таймера и stall, реальный lifecycle JSON. Это отдельные локальные наблюдения, не строгий A/B и не VPS/latency SLA.

Запуск из корня: `npm run server:start`; watch/restart для разработки — `npm run server:dev`. Требуются установленные root и `tools/multiplayer-spike` dependencies, рекомендован Node22.23.3 (та же версия Docker). Перезапуск watch завершает ephemeral комнаты. По умолчанию порт2577; factory принимает ephemeral port для тестов.
