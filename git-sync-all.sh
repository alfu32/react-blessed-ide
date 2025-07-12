#!/usr/bin/env bash

git push origin work
git checkout staging
git merge --ff-only work
git push origin staging
git checkout published
git merge --ff-only work
git push origin published
git checkout work