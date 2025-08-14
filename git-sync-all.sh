#!/usr/bin/env bash

git pull origin work
git push origin work --tags
git checkout staging
git pull origin staging
git merge --ff-only work
git push origin staging --tags
git checkout published
git pull origin published
git merge --ff-only work
git push origin published --tags
git checkout work