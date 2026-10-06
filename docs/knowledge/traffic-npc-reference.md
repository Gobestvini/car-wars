# Источники и механики городского NPC-трафика

Подготовлено 2026-10-06 для TASK-0034/0035/0036. Это предварительный отбор автора, не итог исследования и не доказательство исправления CarWars. Runtime-баги при подготовке не воспроизводились. Изменения production кода не выполнялись.

## Проверенные первичные источники

| Источник | Что подтверждает | Применение и пределы |
| --- | --- | --- |
| [SUMO VehicleInsertion](https://sumo.dlr.de/userdoc/Simulation/VehicleInsertion.html) | Перед вставкой учитываются занимаемое место/minGap, безопасность лидера и следующей машины, возможность затормозить у ограничения. При нехватке места вставка откладывается в очередь. | Для TASK-0035: проверять footprint/скорости до создания тела и отложенные заявки ограниченной квотой. SUMO не нужен как зависимость; запрет принудительной unsafe insertion — требование CarWars. |
| [IDM/ACC, Martin Treiber](https://traffic-simulation.de/info/info_IDM.html) | Продольное ускорение зависит от собственной скорости, bumper gap и относительной скорости. Красный свет можно моделировать неподвижным ограничителем в stop-plane. Численное торможение должно завершаться нулевой скоростью, не отрицательной. | Для TASK-0034/0036: сравнить с current sqrt speed bound, адаптировать параметры к городу. В physical mode результат служит заданием controller, позицию интегрирует Cannon. |
| [MOBIL, Martin Treiber](https://traffic-simulation.de/info/info_MOBIL.html) | Перестроение требует safety и incentive критериев, учитывает торможение заднего автомобиля целевой полосы. Порог выгоды и cooldown препятствуют непрерывному переключению полос. | Для TASK-0036: полезен safety gate и cooldown; полный incentive model может быть избыточен для одной полосы и объезда локального препятствия. Встречный обгон требует дополнительного прогноза полного манёвра. |
| [SUMO Intersections](https://sumo.dlr.de/userdoc/Simulation/Intersections.html) | No-block/keep-clear запрещает въезд, если вероятна остановка внутри из-за заполненной исходящей дороги. Документация также описывает способы разрешения заторов. | Применить outbound-space gate. Teleport/ignore collisions варианты не переносить: пользователь хочет физический городской трафик и безопасное освобождение. |
| [CARLA Traffic Manager](https://carla.readthedocs.io/en/latest/adv_traffic_manager/) | Loop разделяет localization, path collision forecast, traffic rules и motion planning; этапы используют согласованное состояние и синхронизацию. Bounding boxes расширяются вдоль предполагаемого пути. | Для CarWars: единый snapshot, короткий path buffer и swept-footprint hazards перед controls. Это архитектурный ориентир; CARLA сама описывает ограничения junction priority, поэтому не копировать её как безусловно правильный ПДД-движок. |

Все ссылки прочитаны/проверены через web 2026-10-06; source «latest» может измениться, исполнитель записывает актуальную дату. Резюме — пересказ, не цитаты. Источники не обещают решение физических contact jams без адаптации к конкретному движку.

## Факты текущего кода

- add выбирает slot по index/requestedCount и трём fractions; before-insertion occupancy проверки нет. При count increase старые машины остаются в ранее выбранных slot positions, новые получают схему нового count.
- reset возвращает NPC в старые spawn coordinates без переоценки занятости. applyCount без очереди добирает весь count через while.
- noProgressTime растёт только если есть leader.blocker и не yielding; отсутствие лидера при застревании или неверном route не приводит к recovery.
- passingOffset проверяет текущие позиции; не оценивает swept volumes/relative velocities и подтверждённый путь возврата. Манёвр прекращается по изменению лидера или таймеру8с.
- reservation claim/release и controls выполняются в одном for-loop; exit-space gate не выражен. Произвольный timeout не является доказательством освобождения junction.
- Logical машины имеют body-подобное состояние без world contacts; на activation есть center-distance clearance только от player/physical NPC. Проблема overlap требует учитывать обе разновидности.
- Предыдущие TASK-0024/0027/0028 оставлены review; их чекбоксы/проходящие smoke tests не заменяют воспроизведения последних жалоб пользователя.

## Рекомендованный набор для оценки

Это рекомендации автора для исследования34, не утверждение «лучший алгоритм»:

1. Safe insertion очередь с ориентированным footprint, leader/follower headway, deterministic slots и явным desired/active/pending.
2. Path-relative lane coordinate и прогресс по пройденной дуге, lookahead по скорости; отделить lost-route/controller stall от законной очереди.
3. Ограниченная car-following target acceleration и stop-plane hazard; shared input/output для logical и physical с разным исполнением движения.
4. Keep-clear outbound check и справедливый FIFO/aging junction admission; entered ownership действует до фактического освобождения всем кузовом.
5. Snapshot→hazards→decisions→controls, spatial shortlist вместо постоянного full pairwise sensing; каждый transition проверяется на fixed-step boundary.
6. Подтверждённый безопасный коридор манёвра с прогнозом переднего/заднего/встречного движения, return path, cooldown и устойчивым уступающим приоритетом.
7. FSM с reason/blocker/progress/timestamps и ограниченным retry. Полностью закрытая дорога остаётся законной остановкой; после открытия условия проверяются заново.

## Что должен выдать TASK-0034

Сравнительную таблицу текущей и предложенной схемы; воспроизведения overlap/stall; выбранные interfaces и FSM; значения в метрах/секундах и стоимость на60/300; план regression traces для каждого нарушения. Итог — docs/knowledge/traffic-npc-design.md и актуализированная TASK-0036. Полный highway MOBIL, внешние SUMO/CARLA серверы, пешеходы и визуальные «фичи характера» вне данного запроса.

