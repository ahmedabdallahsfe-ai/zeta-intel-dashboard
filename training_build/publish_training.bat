@echo off
setlocal
REM ======================================================================
REM  publish_training.bat -- push ONLY the training dashboard to GitHub Pages
REM  (training\ folder + training_build\ scripts). Production files are not
REM  staged. The demo password file is excluded by training_build\.gitignore.
REM  Live link after ~1 minute:  <your GitHub Pages site>/training/
REM ======================================================================
cd /d "%~dp0\.."
git add training training_build
git add -f training\cache\*.data.js
git commit -m "Training dashboard (sample data) update" -- training training_build
git push
echo Done. Check the training link in about a minute.
pause
