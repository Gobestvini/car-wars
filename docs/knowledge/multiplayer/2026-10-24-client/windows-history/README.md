# Durable копии прежних Windows-команд

2026-10-24 QA проверил ссылки в TASK-0099, README текущей/трёх предыдущих QA и lifecycle note: все85 Markdown-ссылок разрешаются, ссылок на ignored `.log` нет. Исторический текст исполнителя и checks-summary.json также упоминали локальные `.git` журналы; их содержимое теперь сохранено здесь в `.txt`, чтобы оно вошло в Git. [copied-files.json](copied-files.json) фиксирует пути/совпадение SHA-256 оригинала и копии10/10. Поля logLocal в старом summary — происхождение, а не доступный после clone артефакт.

- [client rework6/6](task0099-client-rework.txt), [client rework8/8](task0099-client-rework2-affinity.txt), [client rework10/10](task0099-client-rework3.txt).
- [Production build](task0099-build.txt), [server regressions11/11](task0099-server-regressions.txt).
- [Первый Windows full failed](task0099-full-failed.txt), [повтор full failed](task0099-full-repeat-failed.txt), [изолированные baseline repeats](task0099-repeat.txt).
- [Диагностический no-opt failed](task0099-suite-noopt.txt), [предыдущий final full CPU0 failed](task0099-final-full.txt).

Это сохранение исторических результатов, не новые прогоны. Failed/no-opt/старые source результаты не заменяют окончательный optimized Linux full/build gate. Native/V8 причина не установлена; affinity не является доказанным исправлением. В `qa-final/` сохранены также его структурированная failed-квитанция и полный verifier output.
